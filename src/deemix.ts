import _ from "lodash";
const deemixUrl = "http://127.0.0.1:7272";
import { getAllLidarrArtists } from "./lidarr.js";
import { titleCase, normalize } from "./helpers.js";
import { link } from "fs";

/**
 * Interface für ein dedupliziertes Album
 */
export interface AlbumDTO {
  Id: string;
  OldIds: string[];
  ReleaseStatuses: string[];
  SecondaryTypes: string[];
  Title: string;
  LowerTitle: string;
  Type: string;
  availableFormats: string[];
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
 * Einfacher Fuzzy-Vergleich: Vergleicht zwei Titel nach Normalisierung.
 */
function isSimilar(title1: string, title2: string): boolean {
  const n1 = normalize(title1);
  const n2 = normalize(title2);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

/**
 * Entfernt Duplikate aus einer Albumliste.
 */
function deduplicateAlbums(albums: AlbumDTO[]): AlbumDTO[] {
  const deduped: AlbumDTO[] = [];
  for (const album of albums) {
    if (!deduped.some((a) => isSimilar(a.Title, album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

/**
 * Liest aus der Deemix-API eine Künstlerliste ein.
 */
export async function deemixArtists(name: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/search/artists?limit=100&offset=0&q=${name}`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object") return [];
  const j = jsonRaw as Record<string, any>;
  return j["data"] as any[];
}

/**
 * Liest ein Album von Deemix ein.
 */
export async function deemixAlbum(id: string): Promise<any> {
  const res = await fetch(`${deemixUrl}/albums/${id}`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object")
    throw new Error("Unexpected response in deemixAlbum");
  const j = jsonRaw as Record<string, any>;
  return j;
}

/**
 * Liest die Tracks eines Albums ein.
 */
export async function deemixTracks(id: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/album/${id}/tracks`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object") return [];
  const j = jsonRaw as Record<string, any>;
  return j.data as any[];
}

/**
 * Liest einen Künstler von Deemix ein.
 */
export async function deemixArtist(id: string): Promise<any> {
  const res = await fetch(`${deemixUrl}/artists/${id}`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object")
    throw new Error("Unexpected response in deemixArtist");
  const j = jsonRaw as Record<string, any>;
  return {
    Albums: j["albums"]["data"].map((a: any) => ({
      Id: fakeId(a["id"], "album"),
      OldIds: [] as string[],
      ReleaseStatuses: ["Official"],
      SecondaryTypes: a["title"].toLowerCase().includes("live") ? ["Live"] : [],
      Title: a["title"],
      Type: getType(a["record_type"]),
    })),
    artistaliases: [],
    artistname: j["name"],
    disambiguation: "",
    genres: [],
    id: `${fakeId(j["id"], "artist")}`,
    images: [{ CoverType: "Poster", Url: j["picture_xl"] }],
    links: [
      {
        target: j["link"],
        type: "deezer",
      },
    ],
    oldids: [],
    overview: "!!--Imported from Deemix--!!",
    rating: { Count: 0, Value: null },
    sortname: (j["name"] as string).split(" ").reverse().join(", "),
    status: "active",
    type: "Artist",
  };
}

/**
 * Exportiere getAritstByName (Bedenke: Du kannst den Namen in getArtistByName umbenennen, wenn gewünscht).
 */
export async function getAritstByName(name: string): Promise<any> {
  const artists = await deemixArtists(name);
  return artists.find((a: any) => a["name"] === name || normalize(a["name"]) === normalize(name));
}

/**
 * Liest Alben von Deemix ein.
 */
export async function deemixAlbums(name: string): Promise<any[]> {
  let total = 0;
  let start = 0;
  const res = await fetch(`${deemixUrl}/search/albums?limit=1&offset=0&q=${name}`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object")
    throw new Error("Unexpected response in deemixAlbums");
  const j = jsonRaw as Record<string, any>;
  total = j["total"] as number;
  const albums: any[] = [];
  while (start < total) {
    const res2 = await fetch(`${deemixUrl}/search/albums?limit=100&offset=${start}&q=${name}`);
    const jsonRaw2: unknown = await res2.json();
    if (!jsonRaw2 || typeof jsonRaw2 !== "object") break;
    const j2 = jsonRaw2 as Record<string, any>;
    albums.push(...(j2["data"] as any[]));
    start += 100;
  }
  return albums.filter(
    (a: any) =>
      normalize(a["artist"]["name"]) === normalize(name) ||
      a["artist"]["name"] === "Verschillende artiesten"
  );
}

/**
 * Bestimmt die verfügbaren Formate.
 * Wird in der Antwort als availableFormats zurückgegeben.
 */
function getAvailableFormatsFromResponse(response: any): string[] {
  if (response && response.availableFormats && Array.isArray(response.availableFormats)) {
    return response.availableFormats;
  }
  if (process.env.DEEMIX_PREMIUM === "true") {
    return ["flac", "mp3_320", "mp3_128"];
  }
  return ["mp3_128"];
}

function getType(rc: string): string {
  let type = rc.charAt(0).toUpperCase() + rc.slice(1);
  if (type === "Ep") type = "EP";
  return type;
}

/**
 * Liest ein Album ein und erweitert die Antwort um verfügbare Formate.
 */
export async function getAlbum(id: string): Promise<any> {
  const d = await deemixAlbum(id);
  const availableFormats = getAvailableFormatsFromResponse(d);
  const contributors = d["contributors"].map((c: any) => ({
    id: fakeId(c["id"], "artist"),
    artistaliases: [],
    artistname: c["name"],
    disambiguation: "",
    overview: "!!--Imported from Deemix--!!",
    genres: [],
    images: [],
    links: [],
    oldids: [] as string[],
    sortname: (c["name"] as string).split(" ").reverse().join(", "),
    status: "active",
    type: "Artist",
  }));
  const lidarrArtists = await getAllLidarrArtists();
  let lidarr: any = null;
  let deemix: any = null;
  for (const la of lidarrArtists) {
    for (const c of contributors) {
      if (
        la["artistName"] === c["artistname"] ||
        normalize(la["artistName"]) === normalize(c["artistname"])
      ) {
        lidarr = la;
        deemix = c;
      }
    }
  }
  let lidarr2: any = {};
  if (process.env.OVERRIDE_MB === "true") {
    lidarr = deemix;
    lidarr2 = {
      id: lidarr["id"],
      artistname: lidarr["artistname"],
      artistaliases: [],
      disambiguation: "",
      overview: "",
      genres: [],
      images: [],
      links: [],
      oldids: [] as string[],
      sortname: lidarr["artistname"].split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  } else {
    lidarr2 = {
      id: lidarr!["foreignArtistId"],
      artistname: lidarr!["artistName"],
      artistaliases: [],
      disambiguation: "",
      overview: "",
      genres: [],
      images: [],
      links: [],
      oldids: [] as string[],
      sortname: lidarr!["artistName"].split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  }
  const tracks = await deemixTracks(d["id"]);
  return {
    aliases: [],
    artistid: lidarr2["id"],
    artists: [lidarr2],
    disambiguation: "",
    genres: [],
    id: `${fakeId(d["id"], "album")}`,
    images: [{ CoverType: "Cover", Url: d["cover_xl"] }],
    links: [],
    oldids: [] as string[],
    overview: "!!--Imported from Deemix--!!",
    rating: { Count: 0, Value: null },
    releasedate: d["release_date"],
    availableFormats,
    releases: [
      {
        country: ["Worldwide"],
        disambiguation: "",
        id: `${fakeId(d["id"], "release")}`,
        label: [d["label"]],
        media: _.uniqBy(tracks, "disk_number").map((t: any) => ({
          Format: "CD",
          Name: "",
          Position: t["disk_number"],
        })),
        oldids: [] as string[],
        releasedate: d["release_date"],
        status: "Official",
        title: titleCase(d["title"]),
        track_count: d["nb_tracks"],
        tracks: tracks.map((t: any, idx: number) => ({
          artistid: lidarr2["id"],
          durationms: t["duration"] * 1000,
          id: `${fakeId(t["id"], "track")}`,
          mediumnumber: t["disk_number"],
          oldids: [] as string[],
          oldrecordingids: [] as string[],
          recordingid: fakeId(t["id"], "recording"),
          trackname: t["title"],
          tracknumber: `${idx + 1}`,
          trackposition: idx + 1,
        })),
      },
    ],
    secondarytypes: d["title"].toLowerCase().includes("live") ? ["Live"] : [],
    title: titleCase(d["title"]),
    type: getType(d["record_type"]),
  };
}

/**
 * Liest Alben von Deemix ein, mappt sie in ein AlbumDTO-Array und entfernt Duplikate.
 */
export async function getAlbums(name: string): Promise<AlbumDTO[]> {
  const dalbums = await deemixAlbums(name);
  let dtoRalbums: AlbumDTO[] = dalbums.map((d: any) => ({
    Id: `${fakeId(d["id"], "album")}`,
    OldIds: [] as string[],
    ReleaseStatuses: ["Official"],
    SecondaryTypes: d["title"].toLowerCase().includes("live") ? ["Live"] : [],
    Title: titleCase(d["title"]),
    LowerTitle: normalize(d["title"]),
    Type: getType(d["record_type"]),
    availableFormats: getAvailableFormatsFromResponse(d),
  }));
  dtoRalbums = _.uniqBy(dtoRalbums, "LowerTitle");
  dtoRalbums = deduplicateAlbums(dtoRalbums);
  return dtoRalbums;
}

/**
 * Fügt beim Search die Deemix-Ergebnisse zu den Lidarr-Ergebnissen zusammen.
 */
export async function search(lidarr: any, query: string, isManual: boolean = true): Promise<any> {
  const dartists = await deemixArtists(query);
  let lartist: any;
  let lidx = -1;
  let didx = -1;
  if (process.env.OVERRIDE_MB !== "true") {
    for (const [i, artist] of lidarr.entries()) {
      if (artist["album"] === null) {
        lartist = artist;
        lidx = i;
        break;
      }
    }
  }
  if (lartist) {
    let dartist: any;
    for (const [i, d] of dartists.entries()) {
      if (
        lartist["artist"]["artistname"] === d["name"] ||
        normalize(lartist["artist"]["artistname"]) === normalize(d["name"])
      ) {
        dartist = d;
        didx = i;
        break;
      }
    }
    if (dartist) {
      let posterFound = false;
      for (const img of lartist["artist"]["images"] as any[]) {
        if (img["CoverType"] === "Poster") {
          posterFound = true;
          break;
        }
      }
      if (!posterFound) {
        (lartist["artist"]["images"] as any[]).push({
          CoverType: "Poster",
          Url: dartist["picture_xl"],
        });
      }
      lartist["artist"]["oldids"].push(fakeId(dartist["id"], "artist"));
    }
    lidarr[lidx] = lartist;
  }
  if (didx > -1) {
    dartists.splice(didx, 1);
  }
  let dtolartists: any[] = dartists.map((d: any) => ({
    artist: {
      artistaliases: [],
      artistname: d["name"],
      sortname: (d["name"] as string).split(" ").reverse().join(", "),
      genres: [],
      id: `${fakeId(d["id"], "artist")}`,
      images: [{ CoverType: "Poster", Url: d["picture_xl"] }],
      links: [{ target: d["link"], type: "deezer" }],
      type: (d["type"] as string).charAt(0).toUpperCase() + (d["type"] as string).slice(1),
    },
  }));
  if (lidarr.length === 0) {
    const sorted: any[] = [];
    for (const a of dtolartists) {
      if (
        a.artist.artistname === decodeURIComponent(query) ||
        normalize(a.artist.artistname) === normalize(decodeURIComponent(query))
      ) {
        sorted.unshift(a);
      } else {
        sorted.push(a);
      }
    }
    dtolartists = sorted;
  }
  if (!isManual) {
    dtolartists = dtolartists.map((a) => a.artist);
    if (process.env.OVERRIDE_MB === "true") {
      dtolartists = [
        dtolartists.filter((a: any) => {
          return (
            a["artistname"] === decodeURIComponent(query) ||
            normalize(a["artistname"]) === normalize(decodeURIComponent(query))
          );
        })[0],
      ];
    }
  }
  lidarr = [...lidarr, ...dtolartists];
  if (process.env.OVERRIDE_MB === "true") {
    lidarr = dtolartists;
  }
  return lidarr;
}

export async function getArtist(lidarr: any): Promise<any> {
  if (lidarr["error"]) return lidarr;
  const artist = await getAritstByName(lidarr["artistname"]);
  if (typeof artist === "undefined") {
    return lidarr;
  }
  let posterFound = false;
  for (const img of lidarr["images"] as any[]) {
    if (img["CoverType"] === "Poster") {
      posterFound = true;
      break;
    }
  }
  if (!posterFound) {
    (lidarr["images"] as any[]).push({
      CoverType: "Poster",
      Url: artist["picture_xl"],
    });
  }
  const albums = await getAlbums(lidarr["artistname"]);
  let existing = lidarr["Albums"].map((a: any) => normalize(a["Title"]));
  if (process.env.PRIO_DEEMIX === "true") {
    existing = albums.map((a: any) => normalize(a["Title"]));
  }
  if (process.env.OVERRIDE_MB === "true") {
    lidarr["images"] = [{ CoverType: "Poster", Url: artist["picture_xl"] }];
    lidarr["Albums"] = albums;
  } else {
    if (process.env.PRIO_DEEMIX === "true") {
      lidarr["Albums"] = [
        ...lidarr["Albums"].filter((a: any) => !existing.includes(normalize(a["Title"]))),
        ...albums,
      ];
    } else {
      lidarr["Albums"] = [
        ...lidarr["Albums"],
        ...albums.filter((a: any) => !existing.includes(normalize(a["Title"]))),
      ];
    }
  }
  return lidarr;
}
