import fetch from "node-fetch";
import { normalize, titleCase } from "./helpers.js";

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
 * Erzeugt eine garantiert einzigartige Fake-ID für MusicBrainz-Einträge.
 * Nutzt einen Hex-String und ein "MB"-Präfix zur Unterscheidung von Deemix.
 */
function fakeId(id: string, type: string): string {
  // Eindeutiges Präfix für MusicBrainz
  const prefix = "mbid";
  // Konvertiere die MusicBrainz-UUID in einen reinen Hex-String
  const hexId = id.replace(/-/g, "");
  // Erstelle eine UUID-ähnliche Struktur, die garantiert nicht mit echten UUIDs kollidiert.
  return `${prefix}${hexId}`.padEnd(36, '0').slice(0, 36)
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}


function deduplicateAlbums(albums: AlbumDTO[]): AlbumDTO[] {
  const deduped: AlbumDTO[] = [];
  for (const album of albums) {
    if (!deduped.some((a) => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

function getType(releaseGroup: any): string {
  let type = releaseGroup["primary-type"] || "Album";
  type = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  if (type === "Ep") type = "EP";
  return type;
}

export async function getArtistData(query: string): Promise<any> {
  const MB_BASE_URL = "https://musicbrainz.org/ws/2";
  try {
    const artistSearchUrl = `${MB_BASE_URL}/artist?query=artist:${encodeURIComponent(query)}&fmt=json`;
    const artistRes = await fetch(artistSearchUrl, {
        headers: {
            'User-Agent': 'LidarrDeemixProxy/1.0 ( https://github.com/RiDDiX/lidarr-deemix )'
        }
    });
    if (!artistRes.ok) {
        console.error(`MusicBrainz API Fehler (Artist Search): ${artistRes.status}`);
        return null;
    }
    const artistData = await artistRes.json();
    if (!artistData.artists || artistData.artists.length === 0) {
      return null;
    }
    const artist = artistData.artists[0];

    const releaseGroupUrl = `${MB_BASE_URL}/release-group?artist=${artist.id}&fmt=json&limit=100`;
    const rgRes = await fetch(releaseGroupUrl, {
        headers: {
            'User-Agent': 'LidarrDeemixProxy/1.0 ( https://github.com/RiDDiX/lidarr-deemix )'
        }
    });
     if (!rgRes.ok) {
        console.error(`MusicBrainz API Fehler (Release Group): ${rgRes.status}`);
        return { Albums: [], ...artist }; // Gib zumindest den Künstler zurück
    }
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

    const artistAliases = (artist.aliases || []).map((alias: { name: string }) => alias.name);

    return {
      id: fakeId(artist.id, "artist"),
      artistname: artist.name,
      artistaliases: artistAliases,
      disambiguation: artist.disambiguation || "",
      genres: [],
      images: [],
      links: [],
      oldids: [],
      sortname: artist.name.split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
      Albums: albums,
    };
  } catch (error) {
    console.error("Fehler beim Abrufen der MusicBrainz-Daten:", error);
    return null;
  }
}