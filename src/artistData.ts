import fetch from "node-fetch";
import { normalize, titleCase } from "./helpers.js";

const MB_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = 'LidarrDeemixProxy/1.4 ( https://github.com/RiDDiX/lidarr-deemix )';

function createMbid(uuid: string): string {
    return uuid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

export async function getArtistData(mbid: string): Promise<any> {
  try {
    const artistUrl = `${MB_BASE_URL}/artist/${mbid}?inc=release-groups+aliases&fmt=json`;
    const res = await fetch(artistUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    
    const artist = await res.json();
    if (!artist) return null;

    // Alben verarbeiten (Release Groups)
    const albums = (artist["release-groups"] || []).map((rg: any) => ({
      Id: createMbid(rg.id),
      Title: titleCase(rg.title),
      Type: rg["primary-type"] === 'ep' ? 'EP' : titleCase(rg["primary-type"] || 'album'),
      SecondaryTypes: (rg["secondary-types"] || []).includes("Live") ? ["Live"] : [],
      // Minimale Release-Struktur für MusicBrainz
      releases: [{
        Id: createMbid(rg.id),
        Title: titleCase(rg.title),
        status: "Official",
        country: ["Worldwide"],
        label: [""],
        format: "",
        releaseDate: rg["first-release-date"] || "",
        media: [],
        tracks: []
      }]
    }));

    // Künstler-Objekt (MusicBrainz-kompatibel)
    return {
      id: createMbid(artist.id),
      foreignArtistId: createMbid(artist.id),
      artistName: artist.name,
      sortName: artist["sort-name"],
      disambiguation: artist.disambiguation || "",
      overview: artist.disambiguation || "",
      status: "active",
      type: artist.type || "Artist",
      images: [],
      links: [],
      genres: [],
      Albums: albums,
      oldForeignArtistIds: []
    };
  } catch (error) {
    console.error(`Fehler beim Abrufen der MusicBrainz-Daten für MBID ${mbid}:`, error);
    return null;
  }
}