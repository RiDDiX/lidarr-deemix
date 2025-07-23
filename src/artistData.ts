// artistData.ts
import fetch from "node-fetch";
import { normalize, titleCase } from "./helpers.js";

/**
 * Interface für Album Data Transfer Object (DTO)
 */
export interface AlbumDTO {
  Id: string;
  OldIds: string[];
  ReleaseStatuses: string[];
  SecondaryTypes: string[];
  Title: string;
  LowerTitle: string;
  Type: string;
}

/**
 * Erzeugt eine Fake-ID, die anhand des Typs einen Buchstaben-Prefix verwendet.
 */
function fakeId(id: string | number, type: string): string {
  let p = "a";
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  const idStr = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${idStr}`;
}

/**
 * Entfernt Duplikate aus einer Albumliste anhand des Titels.
 */
function deduplicateAlbums(albums: AlbumDTO[]): AlbumDTO[] {
  const deduped: AlbumDTO[] = [];
  for (const album of albums) {
    if (!deduped.some((a) => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

/**
 * Bestimmt den Albumtyp basierend auf dem Release-Group-Typ.
 * Erwartet wird ein Wert wie "Album", "EP", "Single".
 */
function getType(releaseGroup: any): string {
  let type = releaseGroup["primary-type"] || "Album";
  type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  if (type === "Ep") type = "EP";
  return type;
}

/**
 * Ruft Künstler- und Albumdaten von MusicBrainz ab.
 * Es wird zunächst der Künstler gesucht, danach werden dessen Release-Groups (Alben, EPs, Singles) abgefragt.
 */
export async function getArtistData(query: string): Promise<any> {
  const MB_BASE_URL = "https://musicbrainz.org/ws/2";
  try {
    // Suche den Künstler
    const artistSearchUrl = `${MB_BASE_URL}/artist?query=artist:${encodeURIComponent(query)}&fmt=json`;
    const artistRes = await fetch(artistSearchUrl);
    const artistData = await artistRes.json();
    if (!artistData.artists || artistData.artists.length === 0) {
      return null; // Künstler nicht gefunden
    }
    // Wähle den ersten passenden Künstler
    const artist = artistData.artists[0];

    // Hole Release-Groups (Alben, EPs, Singles) des Künstlers
    const releaseGroupUrl = `${MB_BASE_URL}/release-group?artist=${artist.id}&fmt=json&limit=100`;
    const rgRes = await fetch(releaseGroupUrl);
    const rgData = await rgRes.json();
    let albums: AlbumDTO[] = [];
    if (rgData["release-groups"] && Array.isArray(rgData["release-groups"])) {
      albums = rgData["release-groups"].map((rg: any) => {
        const title = titleCase(rg.title);
        return {
          Id: fakeId(rg.id, "album"),
          OldIds: [],
          ReleaseStatuses: ["Official"],
          SecondaryTypes: (rg["secondary-types"] && rg["secondary-types"].includes("Live")) ? ["Live"] : [],
          Title: title,
          LowerTitle: normalize(title),
          Type: getType(rg),
        };
      });
      albums = deduplicateAlbums(albums);
    }
    // Rückgabe des Künstlerobjekts im Lidarr-ähnlichen Format
    return {
      id: fakeId(artist.id, "artist"),
      artistname: artist.name,
      artistaliases: artist["aliases"] || [],
      disambiguation: artist.disambiguation || "",
      genres: [], // MusicBrainz liefert standardmäßig keine Genres
      images: [], // Kann später durch andere Quellen ergänzt werden
      links: [],
      oldids: [],
      sortname: artist.name.split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
      Albums: albums,
    };
  } catch (error) {
    console.error("Error fetching MusicBrainz data:", error);
    return null;
  }
}
