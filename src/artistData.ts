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

    const albums = (artist["release-groups"] || []).map((rg: any) => ({
      Id: createMbid(rg.id),
      Title: titleCase(rg.title),
      ReleaseStatuses: ["Official"],
      SecondaryTypes: (rg["secondary-types"] || []).includes("Live") ? ["Live"] : [],
      Type: rg["primary-type"] === 'ep' ? 'EP' : titleCase(rg["primary-type"] || 'album'),
    }));

    return {
      artistname: artist.name,
      foreignArtistId: createMbid(artist.id),
      id: createMbid(artist.id),
      sortname: artist["sort-name"],
      disambiguation: artist.disambiguation || "",
      overview: artist.disambiguation || "",
      artistaliases: (artist.aliases || []).map((a: any) => a.name),
      Albums: albums,
      genres: [],
      links: [],
      images: [],
      status: "active",
      type: "Artist",
      // === DER FINALE FIX (AUCH HIER NÖTIG) ===
      OldForeignArtistIds: [],
      oldids: [],
    };
  } catch (error) {
    console.error(`Fehler beim Abrufen der MusicBrainz-Daten für MBID ${mbid}:`, error);
    return null;
  }
}