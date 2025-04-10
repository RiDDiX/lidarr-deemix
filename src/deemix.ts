// deemix.ts
import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";
import { getArtistData } from "./artistData.js";
import { mergeAlbumLists } from "./helpers.js";
import { getAllLidarrArtists } from "./lidarr.js";

// Basis-URL für den Deemix-Server: Standardmäßig Port 7272 verwenden.
const deemixUrl = process.env.DEEMIX_URL || "http://localhost:7272";

// Erzeugt eine Fake-ID anhand des Typs.
export function fakeId(id: string | number, type: string): string {
  let p = "a";
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  const idStr = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${idStr}`;
}

// Bestimmt den Typ anhand des record_type.
function getType(rc: string): string {
  let type = rc.charAt(0).toUpperCase() + rc.slice(1).toLowerCase();
  if (type === "Ep") type = "EP";
  return type;
}

// Ruft Künstler von Deemix ab.
export async function deemixArtists(name: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object") return [];
  const j = jsonRaw as any;
  return j["data"] as any[];
}

// Ruft ein Album von Deemix ab.
export async function deemixAlbum(id: string): Promise<any> {
  const res = await fetch(`${deemixUrl}/albums/${id}`);
  const j = await res.json();
  return j;
}

// Ruft die Tracks eines Albums von Deemix ab.
export async function deemixTracks(id: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/album/${id}/tracks`);
  const j = await res.json();
  return j.data as any[];
}

// Ruft einen einzelnen Künstler von Deemix ab.
// Wenn der Parameter Ziffern enthält, wird er als ID genutzt, sonst als Name.
export async function deemixArtist(idOrName: string): Promise<any> {
  if (/\d/.test(idOrName)) {
    const res = await fetch(`${deemixUrl}/artists/${idOrName}`);
    if (!res.ok) {
      console.error(`Deemix API returned error ${res.status} for artist ID ${idOrName}`);
      const errText = await res.text();
      console.error("Response:", errText);
      throw new Error(`Deemix API error, status ${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Deemix API returned non-JSON response:", text);
      throw new Error("Invalid JSON response from Deemix API");
    }
    const j = await res.json();
    return {
      Albums: j["albums"]["data"].map((a: any) => ({
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
    const artist = artists.find(
      (a: any) => a["name"] === idOrName || normalize(a["name"]) === normalize(idOrName)
    );
    return artist ? artist : null;
  }
}

// Ruft Alben von Deemix ab.
export async function deemixAlbums(name: string): Promise<any[]> {
  // Zuerst ermitteln wir die Gesamtanzahl
  const res = await fetch(`${deemixUrl}/search/albums?limit=1&offset=0&q=${encodeURIComponent(name)}`);
  const json = await res.json();
  const total = json["total"] as number;
  const albums: any[] = [];
  for (let start = 0; start < total; start += 100) {
    const resBatch = await fetch(
      `${deemixUrl}/search/albums?limit=100&offset=${start}&q=${encodeURIComponent(name)}`
    );
    const jsonBatch = await resBatch.json();
    albums.push(...(jsonBatch["data"] as any[]));
  }
  return albums.filter((a: any) =>
    normalize(a["artist"]["name"]) === normalize(name) ||
    a["artist"]["name"] === "Verschillende artiesten"
  );
}

// Entfernt Duplikate aus einer Albumliste anhand des Titels.
export function deduplicateAlbums(albums: any[]): any[] {
  const deduped: any[] = [];
  for (const album of albums) {
    if (!deduped.some(a => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

// Ruft ein Album samt Tracks und verknüpften Künstlern ab.
export async function getAlbum(id: string): Promise<any> {
  const d = await deemixAlbum(id);
  const contributors = d["contributors"].map((c: any) => ({
    id: fakeId(c["id"], "artist"),
    artistaliases: [],
    artistname: c["name"],
    disambiguation: "",
    overview: "!!--Imported from Deemix--!!",
    genres: [],
    images: [],
    links: [],
    oldids: [],
    sortname: (c["name"] as string).split(" ").reverse().join(", "),
    status: "active",
    type: "Artist",
  }));
  const lidarrArtists = await getAllLidarrArtists();
  let lidarr = null;
  let deemixContributor = null;
  for (const la of lidarrArtists) {
    for (const c of contributors) {
      if (
        la["artistName"] === c["artistname"] ||
        normalize(la["artistName"]) === normalize(c["artistname"])
      ) {
        lidarr = la;
        deemixContributor = c;
        break;
      }
    }
  }
  let lidarrArtist: any = {};
  if (process.env.OVERRIDE_MB === "true") {
    lidarr = deemixContributor;
    lidarrArtist = {
      id: lidarr["id"],
      artistname: lidarr["artistname"],
      artistaliases: [],
      disambiguation: "",
      overview: "",
      genres: [],
      images: [],
      links: [],
      oldids: [],
      sortname: lidarr["artistname"].split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  } else {
    lidarrArtist = {
      id: lidarr!["foreignArtistId"],
      artistname: lidarr!["artistName"],
      artistaliases: [],
      disambiguation: "",
      overview: "",
      genres: [],
      images: [],
      links: [],
      oldids: [],
      sortname: lidarr!["artistName"].split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  }
  const tracks = await deemixTracks(d["id"]);
  return {
    aliases: [],
    artistid: lidarrArtist["id"],
    artists: [lidarrArtist],
    disambiguation: "",
    genres: [],
    id: fakeId(d["id"], "album"),
    images: [{ CoverType: "Cover", Url: d["cover_xl"] }],
    links: [],
    oldids: [],
    overview: "!!--Imported from Deemix--!!",
    rating: { Count: 0, Value: null },
    releasedate: d["release_date"],
    releases: [
      {
        country: ["Worldwide"],
        disambiguation: "",
        id: fakeId(d["id"], "release"),
        label: [d["label"]],
        media: _.uniqBy(tracks, "disk_number").map((t: any) => ({
          Format: "CD",
          Name: "",
          Position: t["disk_number"],
        })),
        oldids: [],
        releasedate: d["release_date"],
        status: "Official",
        title: titleCase(d["title"]),
        track_count: d["nb_tracks"],
        tracks: tracks.map((t: any, idx: number) => ({
          artistid: lidarrArtist["id"],
          durationms: t["duration"] * 1000,
          id: fakeId(t["id"], "track"),
          mediumnumber: t["disk_number"],
          oldids: [],
          oldrecordingids: [],
          recordingid: fakeId(t["id"], "recording"),
          trackname: t["title"],
          tracknumber: `${idx + 1}`,
          trackposition: idx + 1,
        })),
      },
    ],
    secondarytypes: d["title"].toLowerCase().includes("live") ? ["Live"] : [],
    Title: titleCase(d["title"]),
    LowerTitle: normalize(d["title"]),
    Type: getType(d["record_type"]),
  };
}

// Ruft Alben von Deemix ab, dedupliziert und wandelt sie in DTOs um.
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
  dtoAlbums = deduplicateAlbums(dtoAlbums);
  return dtoAlbums;
}

// Fügt beim Search die Deemix-Ergebnisse zu den Lidarr-Ergebnissen zusammen.
export async function search(lidarr: any, query: string, isManual: boolean = true): Promise<any> {
  if (!Array.isArray(lidarr)) {
    lidarr = [];
  }
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
      id: fakeId(d["id"], "artist"),
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
        dtolartists.filter((a) => {
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

// Holt den finalen Künstler-Datensatz. Priorität: MusicBrainz (getArtistData) > Deezer/Deemix.
export async function getArtist(lidarr: any): Promise<any> {
  if (lidarr["error"]) return lidarr;
  const mbArtist = await getArtistData(lidarr["artistname"]);
  if (mbArtist && mbArtist.Albums && mbArtist.Albums.length > 0) {
    const deemixAlbums = await getAlbums(lidarr["artistname"]);
    mbArtist.Albums = mergeAlbumLists(mbArtist.Albums, deemixAlbums);
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
