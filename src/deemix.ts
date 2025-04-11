import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase, mergeAlbumLists } from "./helpers.js";
import { getAllLidarrArtists } from "./lidarr.js";
import { getArtistData } from "./artistData.js";

// Entfernt Duplikate aus einer Albumliste anhand des Titels.
function deduplicateAlbums(albums: any[]): any[] {
  const deduped: any[] = [];
  for (const album of albums) {
    // Hier wird davon ausgegangen, dass das DTO-Feld "Title" benutzt wird
    if (!deduped.some(a => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

const deemixUrl = process.env.DEEMIX_URL || "http://localhost:7272";

export function fakeId(id: string | number, type: string): string {
  let p = "a";
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  const idStr = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${idStr}`;
}

function getType(rc: string): string {
  let type = rc.charAt(0).toUpperCase() + rc.slice(1).toLowerCase();
  if (type === "Ep") type = "EP";
  return type;
}

export async function deemixArtists(name: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  const j = await res.json();
  return j["data"] || [];
}

export async function deemixAlbum(id: string): Promise<any> {
  const res = await fetch(`${deemixUrl}/albums/${id}`);
  return await res.json();
}

export async function deemixTracks(id: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/album/${id}/tracks`);
  const j = await res.json();
  return j.data || [];
}

export async function deemixArtist(idOrName: string): Promise<any> {
  if (/\d/.test(idOrName)) {
    const res = await fetch(`${deemixUrl}/artists/${idOrName}`);
    const j = await res.json();
    return {
      albums: j["albums"]["data"].map((a: any) => ({
        Id: fakeId(a["id"], "album"),
        OldIds: [],
        ReleaseStatuses: ["Official"],
        SecondaryTypes: a["title"].toLowerCase().includes("live") ? ["Live"] : [],
        Title: a["title"],
        LowerTitle: normalize(a["title"]),
        Type: getType(a["record_type"]),
      })),
      artistaliases: [],
      artistname: j["name"],
      disambiguation: "",
      genres: [],
      id: fakeId(j["id"], "artist"),
      images: [{ CoverType: "Poster", Url: j["picture_xl"] }],
      links: [{ target: j["link"], type: "deezer" }],
      oldids: [],
      overview: "!!--Imported from Deemix--!!",
      sortname: (j["name"] as string).split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  } else {
    const artists = await deemixArtists(idOrName);
    return artists.find(
      (a: any) => a["name"] === idOrName || normalize(a["name"]) === normalize(idOrName)
    ) || null;
  }
}

export async function getAlbums(name: string): Promise<any[]> {
  const dalbums = await deemixAlbums(name);
  let dtoAlbums = dalbums.map((d: any) => ({
    Id: fakeId(d["id"], "album"),
    OldIds: [],
    ReleaseStatuses: ["Official"],
    SecondaryTypes: d["title"].toLowerCase().includes("live") ? ["Live"] : [],
    Title: titleCase(d["title"]),
    LowerTitle: normalize(d["title"]),
    Type: getType(d["record_type"]),
  }));
  dtoAlbums = _.uniqBy(dtoAlbums, "LowerTitle");
  return deduplicateAlbums(dtoAlbums);
}

async function deemixAlbums(name: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/search/albums?limit=1&offset=0&q=${encodeURIComponent(name)}`);
  const json = await res.json();
  const total = json["total"] || 0;
  const albums: any[] = [];
  for (let start = 0; start < total; start += 100) {
    const resBatch = await fetch(
      `${deemixUrl}/search/albums?limit=100&offset=${start}&q=${encodeURIComponent(name)}`
    );
    const jsonBatch = await resBatch.json();
    albums.push(...(jsonBatch["data"] || []));
  }
  return albums.filter((a: any) =>
    normalize(a["artist"]["name"]) === normalize(name) ||
    a["artist"]["name"] === "Verschillende artiesten"
  );
}

export async function getArtist(lidarr: any): Promise<any> {
  if (lidarr["error"]) return lidarr;
  const mbArtist = getArtistData(lidarr["artistname"]); // Nun wird ein Parameter übergeben
  if (mbArtist && mbArtist.albums && mbArtist.albums.length > 0) {
    const deemixAlbumsResult = await getAlbums(lidarr["artistname"]);
    mbArtist.albums = mergeAlbumLists(mbArtist.albums, deemixAlbumsResult);
    if (!mbArtist.images || mbArtist.images.length === 0) {
      const dArtist = await deemixArtist(lidarr["artistname"]);
      if (dArtist && dArtist.images && dArtist.images.length > 0) {
        mbArtist.images = dArtist.images;
      }
    }
    return mbArtist;
  } else {
    return await deemixArtist(lidarr["artistname"]);
  }
}

// Exportiere getAlbum als Alias für deemixAlbum, damit index.ts darauf zugreifen kann.
export const getAlbum = deemixAlbum;
