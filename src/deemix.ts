import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";
import { getArtistData } from "./artistData.js";
import { mergeAlbumLists } from "./helpers.js";
import { getAllLidarrArtists } from "./lidarr.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

async function safeDeemixFetch(path: string) {
    try {
        const res = await fetch(`${deemixUrl}${path}`);
        if (!res.ok) {
            console.warn(`Deemix-Server antwortete mit Fehler ${res.status} für Pfad: ${path}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(`Fehler bei der Verbindung zum Deemix-Server für Pfad: ${path}`, e);
        return null;
    }
}

function fakeId(id: string | number, type: string): string {
    const prefix = "deez";
    const hexId = Number(id).toString(16);
    return `${prefix}${hexId}`.padEnd(36, '0').slice(0, 36)
      .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function deduplicateAlbums(albums: any[]): any[] {
  const deduped: any[] = [];
  for (const album of albums) {
    if (!deduped.some((a) => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

export async function deemixArtists(name: string): Promise<any[]> {
  const json = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  return json?.data || [];
}

export async function deemixAlbum(id: string): Promise<any> {
  const realId = id.includes('deez') ? parseInt(id.replace(/deez|-/g, ''), 16).toString() : id;
  return await safeDeemixFetch(`/albums/${realId}`);
}

export async function deemixTracks(id: string): Promise<any[]> {
  const realId = id.includes('deez') ? parseInt(id.replace(/deez|-/g, ''), 16).toString() : id;
  const json = await safeDeemixFetch(`/album/${realId}/tracks`);
  return json?.data || [];
}

export async function deemixArtist(idOrName: string): Promise<any> {
  const isFakeId = idOrName.includes('deez');
  const query = isFakeId ? parseInt(idOrName.replace(/deez|-/g, ''), 16).toString() : idOrName;

  if (/^\d+$/.test(query)) {
    const j = await safeDeemixFetch(`/artists/${query}`);
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
    const artists = await deemixArtists(query);
    const artist = artists.find((a: any) => a["name"] === query || normalize(a["name"]) === normalize(query));
    return artist ? artist : null;
  }
}

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

function getType(rc: string): string {
  if (!rc) return "Album";
  let type = rc.charAt(0).toUpperCase() + rc.slice(1).toLowerCase();
  if (type === "Ep") {
    type = "EP";
  }
  return type;
}

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
      sortname: (lidarr["artistname"] || lidarr["artistName"]).split(" ").reverse().join(", "),
    };
  } else if(lidarr) {
    lidarrArtist = {
      id: lidarr["foreignArtistId"] || lidarr["id"],
      artistname: lidarr["artistName"] || lidarr["artistname"],
      sortname: (lidarr["artistName"] || lidarr["artistname"]).split(" ").reverse().join(", "),
    };
  } else {
      const primaryArtist = contributors.length > 0 ? contributors[0] : { id: 'unknown', artistname: 'Unknown Artist', sortname: 'Artist, Unknown'};
      lidarrArtist = { ...primaryArtist };
  }

  const tracks = await deemixTracks(d["id"].toString());
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
      if (normalize(lartist["artist"]["artistname"]) === normalize(d["name"])) {
        dartist = d;
        didx = i;
        break;
      }
    }
    if (dartist) {
      if (!(lartist["artist"]["images"] || []).some((img: any) => img.CoverType === "Poster")) {
        lartist["artist"]["images"].push({
          CoverType: "Poster",
          Url: dartist["picture_xl"],
        });
      }
      lartist["artist"]["oldids"].push(fakeId(dartist["id"], "artist"));
    }
    if (lidx > -1) lidarr[lidx] = lartist;
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
      type: "Artist",
    },
  }));
  
  if (process.env.OVERRIDE_MB === "true") {
      return dtolartists;
  }

  return [...lidarr, ...dtolartists];
}

export async function getArtist(lidarr: any): Promise<any> {
  const artistName = lidarr?.["artistname"];
  if (!artistName) return null;

  const mbArtist = await getArtistData(artistName);
  if (mbArtist) {
    // === KORRIGIERTE ZEILE ===
    const albums = await deemixAlbums(artistName); 
    mbArtist.Albums = mergeAlbumLists(mbArtist.Albums, albums);
    return mbArtist;
  } else {
    return await deemixArtist(artistName);
  }
}