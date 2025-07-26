// deemix.ts
import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";
import { getArtistData } from "./artistData.js";
import { mergeAlbumLists } from "./helpers.js";
import { getAllLidarrArtists } from "./lidarr.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion für die interne Deemix-API
async function safeDeemixFetch(path: string) {
    try {
        const res = await fetch(`${deemixUrl}${path}`);
        if (!res.ok) {
            // Wenn der Python-Server 404 oder 500 meldet, loggen wir das und geben null zurück
            console.warn(`Deemix-Server antwortete mit Fehler ${res.status} für Pfad: ${path}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(`Fehler bei der Verbindung zum Deemix-Server für Pfad: ${path}`, e);
        return null;
    }
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
function deduplicateAlbums(albums: any[]): any[] {
  const deduped: any[] = [];
  for (const album of albums) {
    if (!deduped.some((a) => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

/**
 * Ruft Künstler von Deemix ab.
 */
export async function deemixArtists(name: string): Promise<any[]> {
  const json = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  return json?.data || [];
}

/**
 * Ruft ein Album von Deemix ab.
 */
export async function deemixAlbum(id: string): Promise<any> {
  return await safeDeemixFetch(`/albums/${id}`);
}

/**
 * Ruft die Tracks eines Albums von Deemix ab.
 */
export async function deemixTracks(id: string): Promise<any[]> {
  const json = await safeDeemixFetch(`/album/${id}/tracks`);
  return json?.data || [];
}

/**
 * Ruft einen einzelnen Künstler von Deemix ab.
 */
export async function deemixArtist(idOrName: string): Promise<any> {
  if (/\d/.test(idOrName)) {
    const j = await safeDeemixFetch(`/artists/${idOrName}`);
    if (!j) return null;

    const albumsData = j.albums?.data || [];

    return {
      Albums: albumsData.map((a: any) => ({
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
      links: [{
        target: j["link"],
        type: "deezer",
      }],
      oldids: [],
      overview: "!!--Imported from Deemix--!!",
      sortname: (j["name"] as string).split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  } else {
    const artists = await deemixArtists(idOrName);
    const artist = artists.find((a: any) => a["name"] === idOrName || normalize(a["name"]) === normalize(idOrName));
    return artist ? artist : null;
  }
}

/**
 * Sucht Alben von Deemix.
 */
export async function deemixAlbums(name: string): Promise<any[]> {
  const initialData = await safeDeemixFetch(`/search/albums?limit=1&offset=0&q=${encodeURIComponent(name)}`);
  if (!initialData || !initialData.total) {
      return [];
  }

  const total = initialData.total as number;
  const promises = [];
  for (let start = 0; start < total; start += 100) {
    promises.push(
      safeDeemixFetch(`/search/albums?limit=100&offset=${start}&q=${encodeURIComponent(name)}`)
        .then(j2 => j2?.data as any[] || [])
    );
  }
  const results = await Promise.all(promises);
  const albums = results.flat();
  return albums.filter((a: any) =>
    normalize(a?.artist?.name || "") === normalize(name) ||
    a?.artist?.name === "Verschillende artiesten"
  );
}

/**
 * Bestimmt den Typ basierend auf dem record_type.
 */
function getType(rc: string): string {
  if (!rc) return "Album";
  let type = rc.charAt(0).toUpperCase() + rc.slice(1).toLowerCase();
  if (type === "Ep") {
    type = "EP";
  }
  return type;
}

/**
 * Ruft ein Album samt Tracks und verknüpften Künstlern ab.
 */
export async function getAlbum(id: string): Promise<any> {
  const d = await deemixAlbum(id);
  if (!d) return null;

  const contributors = (d["contributors"] || []).map((c: any) => ({
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
  let lidarr: any = null;
  let deemixContributor = null;
  for (const la of lidarrArtists) {
    for (const c of contributors) {
      if (la["artistName"] === c["artistname"] || normalize(la["artistName"]) === normalize(c["artistname"])) {
        lidarr = la;
        deemixContributor = c;
        break;
      }
    }
  }
  
  if (!lidarr && deemixContributor) {
      lidarr = deemixContributor;
  }

  let lidarrArtist: any = {};
  if (process.env.OVERRIDE_MB === "true" && lidarr) {
    lidarrArtist = {
      id: lidarr["id"],
      artistname: lidarr["artistname"] || lidarr["artistName"],
      artistaliases: [],
      disambiguation: "",
      overview: "",
      genres: [],
      images: [],
      links: [],
      oldids: [],
      sortname: (lidarr["artistname"] || lidarr["artistName"]).split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  } else if(lidarr) {
    lidarrArtist = {
      id: lidarr["foreignArtistId"],
      artistname: lidarr["artistName"],
      artistaliases: [],
      disambiguation: "",
      overview: "",
      genres: [],
      images: [],
      links: [],
      oldids: [],
      sortname: lidarr["artistName"].split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    };
  } else {
      const primaryArtist = contributors.length > 0 ? contributors[0] : { id: 'unknown', artistname: 'Unknown Artist', sortname: 'Artist, Unknown'};
      lidarrArtist = {
          id: primaryArtist.id,
          artistname: primaryArtist.artistname,
          sortname: primaryArtist.sortname
          //... Fülle weitere Standardwerte bei Bedarf
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
    releases: [{
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
      tracks: (tracks || []).map((t: any, idx: number) => ({
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
    }],
    secondarytypes: d["title"].toLowerCase().includes("live") ? ["Live"] : [],
    Title: titleCase(d["title"]),
    LowerTitle: normalize(d["title"]),
    Type: getType(d["record_type"]),
  };
}

/**
 * Ruft Alben von Deemix ab, wandelt sie in AlbumDTOs um und entfernt Duplikate.
 */
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

/**
 * Fügt beim Search die Deemix-Ergebnisse zu den Lidarr-Ergebnissen zusammen.
 */
export async function search(lidarr: any[], query: string, isManual: boolean = true): Promise<any[]> {
  const dartists = await deemixArtists(query);
  let lartist: any;
  let lidx = -1;
  let didx = -1;

  if (process.env.OVERRIDE_MB !== "true" && Array.isArray(lidarr)) {
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
      if (lartist["artist"]["artistname"] === d["name"] || normalize(lartist["artist"]["artistname"]) === normalize(d["name"])) {
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
      images: [{
        CoverType: "Poster",
        Url: d["picture_xl"],
      }],
      links: [{
        target: d["link"],
        type: "deezer",
      }],
      type: (d["type"] as string).charAt(0).toUpperCase() + (d["type"] as string).slice(1),
    },
  }));

  if (lidarr.length === 0) {
    const sorted: any[] = [];
    for (const a of dtolartists) {
      if (a.artist.artistname === decodeURIComponent(query) || normalize(a.artist.artistname) === normalize(decodeURIComponent(query))) {
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
        dtolartists.find((a: any) => 
          a["artistname"] === decodeURIComponent(query) || normalize(a["artistname"]) === normalize(decodeURIComponent(query))
        ),
      ].filter(Boolean); // Filtert undefined heraus, falls nichts gefunden wird
    }
  }

  let finalResult = [...lidarr, ...dtolartists];
  if (process.env.OVERRIDE_MB === "true") {
    finalResult = dtolartists;
  }
  
  return finalResult;
}

/**
 * Holt den finalen Künstler-Datensatz.
 */
export async function getArtist(lidarr: any): Promise<any> {
  if (lidarr?.["error"]) return lidarr;
  const artistName = lidarr?.["artistname"];
  if (!artistName) return null;

  const mbArtist = await getArtistData(artistName);
  if (mbArtist && mbArtist.Albums && mbArtist.Albums.length > 0) {
    const deemixAlbums = await getAlbums(artistName);
    mbArtist.Albums = mergeAlbumLists(mbArtist.Albums, deemixAlbums);
    if (!mbArtist.images || mbArtist.images.length === 0) {
      const dArtist = await deemixArtist(artistName);
      if (dArtist && dArtist.images && dArtist.images.length > 0) {
        mbArtist.images = dArtist.images;
      }
    }
    return mbArtist;
  } else {
    return await deemixArtist(artistName);
  }
}