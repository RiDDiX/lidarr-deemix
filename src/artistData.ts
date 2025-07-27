import fetch from "node-fetch";
import { normalize, titleCase } from "./helpers.js";

const MB_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = 'LidarrDeemixProxy/1.1 ( https://github.com/RiDDiX/lidarr-deemix )';

function createMbid(uuid: string): string {
    // Stellt sicher, dass die UUID immer im korrekten Format ist
    return uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

export async function getArtistData(query: string): Promise<any> {
  try {
    const searchUrl = `${MB_BASE_URL}/artist?query=artist:${encodeURIComponent(query)}&fmt=json`;
    const res = await fetch(searchUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    const artist = data.artists?.[0];

    if (!artist) return null;

    // Hole Alben für diesen Künstler
    const releaseUrl = `${MB_BASE_URL}/release-group?artist=${artist.id}&fmt=json&limit=100`;
    const releaseRes = await fetch(releaseUrl, { headers: { 'User-Agent': USER_AGENT } });
    const releaseData = releaseRes.ok ? await releaseRes.json() : { "release-groups": [] };

    const albums = (releaseData["release-groups"] || []).map((rg: any) => ({
      Id: createMbid(rg.id),
      Title: titleCase(rg.title),
      // ... weitere Felder
    }));

    return {
      artistname: artist.name,
      foreignArtistId: createMbid(artist.id),
      id: createMbid(artist.id), // Lidarr nutzt `id` und `foreignArtistId`
      sortname: artist["sort-name"],
      disambiguation: artist.disambiguation || "",
      overview: artist.disambiguation || "",
      artistaliases: (artist.aliases || []).map((a: any) => a.name),
      Albums: albums,
    };
  } catch (error) {
    console.error("Fehler beim Abrufen der MusicBrainz-Daten:", error);
    return null;
  }
}

/**
 * Findet einen generischen Künstler auf MusicBrainz, den wir als Platzhalter verwenden können.
 */
export async function findPlaceholderArtist(): Promise<any> {
    // "[no artist]" ist ein offizieller Special Purpose Artist auf MusicBrainz
    const artist = await getArtistData("[no artist]");
    if (artist) {
        return {
            ...artist,
            // Leere die Alben, da sie nicht zum Deemix-Künstler gehören
            Albums: [],
        };
    }
    return null;
}