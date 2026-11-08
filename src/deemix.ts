import { getAllLidarrArtists } from "./lidarr.js";
import { normalize, deduplicateAlbums } from "./helpers.js";
import type { DeemixEntityType } from "./types.js";

const DEEMIX_URL = process.env.DEEMIX_URL || "http://127.0.0.1:7272";
const FETCH_TIMEOUT = 10000;

const TYPE_PREFIX: Record<DeemixEntityType, string> = {
  artist: "a",
  album: "b",
  track: "c",
  release: "d",
  recording: "e",
};

export function fakeId(id: string | number, type: DeemixEntityType): string {
  const prefix = TYPE_PREFIX[type];
  if (String(id).length > 12) {
    // more than 12 digits breaks the UUID format (Guid.TryParse in Lidarr fails)
    console.warn(`Deezer id ${id} has more than 12 digits - fake UUID will not be GUID-shaped`);
  }
  const idStr = String(id).padStart(12, prefix);
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-${prefix.repeat(4)}-${prefix.repeat(4)}-${idStr}`;
}

// last segment allows more than 12 chars so fakeId() output for >12-digit ids still round-trips
const FAKE_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12,}$/;

export function isFakeId(id: string | undefined | null, type: DeemixEntityType): boolean {
  if (!id || !FAKE_ID_SHAPE.test(id)) return false;
  const prefix = TYPE_PREFIX[type];
  const expected = `${prefix.repeat(8)}-${prefix.repeat(4)}-${prefix.repeat(4)}-${prefix.repeat(4)}-`;
  return id.startsWith(expected);
}

export function decodeFakeId(id: string | undefined | null, type: DeemixEntityType): string | null {
  if (!id || !isFakeId(id, type)) return null;
  const prefix = TYPE_PREFIX[type];
  // take the last UUID segment instead of slice(-12) so ids with more
  // than 12 digits still decode correctly
  const suffix = id.split("-").pop() || "";
  const decoded = suffix.replace(new RegExp(`^${prefix}+`), "");
  // only digits may reach the Deemix URL path (rejects "..", "/" etc.)
  return /^\d+$/.test(decoded) ? decoded : null;
}

export function sortName(name: string): string {
  return name.split(" ").reverse().join(", ");
}

// Deezer answers errors with HTTP 200 and {"error": {...}}; entity endpoints
// without an id are treated the same way. The timer also covers the body read.
async function fetchJson(url: string, entity = false): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Deemix request failed: ${response.status} ${url}`);
    }
    const j = (await response.json()) as any;
    if (!j || j["error"] || (entity && j["id"] == null)) return null;
    return j;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function searchDeemixArtists(name: string): Promise<any[]> {
  try {
    const j = await fetchJson(
      `${DEEMIX_URL}/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`
    );
    return Array.isArray(j?.["data"]) ? j["data"] : [];
  } catch (error) {
    console.error("Error searching Deemix artists:", error);
    return [];
  }
}

export async function deemixAlbum(id: string): Promise<any> {
  try {
    return await fetchJson(`${DEEMIX_URL}/albums/${id}`, true);
  } catch (error) {
    console.error("Error fetching Deemix album:", error);
    return null;
  }
}

// Returns null on failure (network, HTTP error, bad payload) so callers can
// tell "no tracks" apart from "tracks unavailable right now"
async function deemixTracks(id: string): Promise<any[] | null> {
  try {
    const j = await fetchJson(`${DEEMIX_URL}/album/${id}/tracks`);
    return Array.isArray(j?.data) ? j.data : null;
  } catch (error) {
    console.error("Error fetching Deemix tracks:", error);
    return null;
  }
}

// raw /artists/{id} payload: artist fields plus albums.data (the discography)
async function deemixArtistPayload(id: string | number): Promise<any> {
  try {
    return await fetchJson(`${DEEMIX_URL}/artists/${id}`, true);
  } catch (error) {
    console.error("Error fetching Deemix artist:", error);
    return null;
  }
}

export async function deemixArtist(id: string): Promise<any> {
  try {
    const j = await deemixArtistPayload(id);
    if (!j) return null;

    const artistAlbums: any[] = deduplicateAlbums(
      Array.isArray(j?.["albums"]?.["data"]) ? j["albums"]["data"] : []
    );

    return {
      Albums: [
        ...artistAlbums.map(toAlbumDto),
      ],
      artistaliases: [],
      artistname: j["name"],
      disambiguation: "",
      genres: [],
      id: fakeId(j["id"], "artist"),
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
      sortname: sortName(j["name"]),
      status: "active",
      type: "Artist",
    };
  } catch (error) {
    console.error("Error fetching Deemix artist:", error);
    return null;
  }
}

// Deezer's account for compilations ("Various Artists" / "Verschillende artiesten" /
// "Verschiedene Interpreten" - the name is locale-dependent, the id is not)
const DEEZER_VARIOUS_ARTISTS_ID = 5080;

// With a known Deezer artist id the discography comes from /artists/{id}
// (albums.data) and text-search hits must belong to that id, so same-name
// artists don't merge. Without an id the old name match is the only option.
// Compilations only count when their title names the artist.
async function deemixAlbums(name: string, deezerId?: string | number): Promise<any[]> {
  try {
    const parsedMax = parseInt(process.env.DEEMIX_MAX_ALBUMS || "500");
    const maxAlbums = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 500;
    const wanted = normalize(name);
    const hasId = deezerId != null && deezerId !== "";

    const [payload, found] = await Promise.all([
      hasId ? deemixArtistPayload(deezerId) : null,
      searchDeemixAlbums(name, maxAlbums),
    ]);
    const discography: any[] = Array.isArray(payload?.["albums"]?.["data"])
      ? payload["albums"]["data"]
      : [];

    const matches = found.filter((a) => {
      const artistId = a?.["artist"]?.["id"];
      if (artistId === DEEZER_VARIOUS_ARTISTS_ID) {
        // padded so "Yes" does not match "Eyes"
        return wanted !== "" && ` ${normalize(a["title"])} `.includes(` ${wanted} `);
      }
      return hasId
        ? String(artistId) === String(deezerId)
        : normalize(a?.["artist"]?.["name"]) === wanted;
    });

    return [...discography, ...matches];
  } catch (error) {
    console.error("Error fetching Deemix albums:", error);
    return [];
  }
}

async function searchDeemixAlbums(name: string, maxAlbums: number): Promise<any[]> {
  const albums: any[] = [];
  let total = maxAlbums;
  for (let start = 0; start < Math.min(total, maxAlbums); start += 100) {
    let j: any;
    try {
      j = await fetchJson(
        `${DEEMIX_URL}/search/albums?limit=100&offset=${start}&q=${encodeURIComponent(name)}`
      );
    } catch (error) {
      // keep the pages fetched so far
      console.error("Deemix albums search failed:", error);
      break;
    }
    const batch = Array.isArray(j?.data) ? j.data : [];
    if (batch.length === 0) break;
    albums.push(...batch);
    total = Number(j["total"]) || 0;
  }
  return albums;
}

// Lidarr's FilterAlbums only accepts the primary types Album/EP/Single/Broadcast/Other;
// anything else (e.g. Deezer's "compile") gets silently dropped from artist responses.
function mapRecordType(rc: string): { type: string; secondary: string[] } {
  switch ((rc || "").toLowerCase()) {
    case "album":
      return { type: "Album", secondary: [] };
    case "ep":
      return { type: "EP", secondary: [] };
    case "single":
      return { type: "Single", secondary: [] };
    case "compile":
    case "compilation":
      return { type: "Album", secondary: ["Compilation"] };
    default:
      return { type: "Other", secondary: [] };
  }
}

function getSecondaryTypes(title: string, recordType: string): string[] {
  const secondary = [...mapRecordType(recordType).secondary];
  if (isLiveTitle(title)) {
    secondary.push("Live");
  }
  return secondary;
}

// "Album (Live)", "Song - Live", "Live at/in/from ..." but not "Live and Let Die" or "Oliver"
export function isLiveTitle(title: string): boolean {
  return /[(\[-]\s*live\b|\blive\s+(at|in|from)\b/i.test(title || "");
}

export async function getAlbum(id: string) {
  try {
    const d = await deemixAlbum(id);
    if (!d) {
      console.error("Failed to fetch album data from Deemix");
      return null;
    }

    const contributors = d["contributors"]?.map((c: any) => ({
      id: fakeId(c["id"], "artist"),
      artistaliases: [],
      artistname: c["name"],
      disambiguation: "",
      overview: "!!--Imported from Deemix--!!",
      genres: [],
      images: [],
      links: [],
      oldids: [],
      sortname: sortName(c["name"]),
      status: "active",
      type: "Artist",
    })) || [];

    const lidarrArtists = await getAllLidarrArtists();

    let lidarr: any = null;
    let deemixMatch: any = null;

    // first contributor wins on equal normalized names, as in the old nested loop
    const contributorsByName = new Map<string, any>();
    for (const c of contributors) {
      const key = normalize(c["artistname"]);
      if (key && !contributorsByName.has(key)) contributorsByName.set(key, c);
    }

    for (const la of lidarrArtists) {
      if (!la["artistName"]) continue;
      const c = contributorsByName.get(normalize(la["artistName"]));
      if (c) {
        lidarr = la;
        deemixMatch = c;
        break;
      }
    }

    const fallbackContributor =
      deemixMatch ||
      contributors[0] ||
      (d["artist"]
        ? {
            id: fakeId(d["artist"]["id"], "artist"),
            artistaliases: [],
            artistname: d["artist"]["name"],
            disambiguation: "",
            overview: "!!--Imported from Deemix--!!",
            genres: [],
            images: [],
            links: d["artist"]["link"]
              ? [
                  {
                    target: d["artist"]["link"],
                    type: "deezer",
                  },
                ]
              : [],
            oldids: [],
            sortname: sortName(d["artist"]["name"]),
            status: "active",
            type: "Artist",
          }
        : null);

    const buildArtistPayload = (artist: any) => ({
      id: artist["id"],
      artistname: artist["artistname"],
      artistaliases: artist["artistaliases"] || [],
      disambiguation: artist["disambiguation"] || "",
      overview: artist["overview"] || "",
      genres: artist["genres"] || [],
      images: artist["images"] || [],
      links: artist["links"] || [],
      oldids: artist["oldids"] || [],
      sortname: artist["sortname"] || sortName(artist["artistname"]),
      status: artist["status"] || "active",
      type: artist["type"] || "Artist",
    });

    let lidarr2: any;

    if (process.env.OVERRIDE_MB === "true") {
      if (!fallbackContributor) {
        throw new Error("Could not determine Deemix artist for album");
      }
      lidarr2 = buildArtistPayload(fallbackContributor);
    } else if (lidarr) {
      lidarr2 = buildArtistPayload({
        id: lidarr["foreignArtistId"],
        artistname: lidarr["artistName"],
        artistaliases: [],
        disambiguation: "",
        overview: "",
        genres: [],
        images: [],
        links: [],
        oldids: [],
        sortname: sortName(lidarr["artistName"]),
        status: "active",
        type: "Artist",
      });
    } else if (fallbackContributor) {
      lidarr2 = buildArtistPayload(fallbackContributor);
    } else {
      throw new Error("Unable to resolve artist information for album");
    }

    const tracks = await deemixTracks(d["id"]);
    if (tracks === null) {
      // Fail the whole album fetch instead of answering with an empty track
      // list - a 0-track 200 would make Lidarr wipe existing tracks on refresh
      console.error(`Tracks for album ${d["id"]} unavailable, failing the album fetch`);
      return null;
    }
    return {
      aliases: [],
      artistid: lidarr2["id"],
      artists: [lidarr2],
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
          label: d["label"] ? [d["label"]] : [],
          media: [...new Set(tracks.map((t: any) => t["disk_number"] || 1))].map((n) => ({
            Format: "CD",
            Name: "",
            Position: n,
          })),
          oldids: [],
          releasedate: d["release_date"],
          status: "Official",
          title: d["title"],
          tracks: tracks.map((t: any, idx: number) => ({
            // PascalCase - that's what Lidarr expects here
            Id: fakeId(t["id"], "track"),
            ArtistCredit: [],
            Title: t["title"],
            // Deezer's album-tracks payload uses track_position (not track_number)
            TrackPosition: t["track_position"] ?? idx + 1,
            MediumNumber: t["disk_number"] || 1,
            Duration: (t["duration"] ?? 0) * 1000,
            RecordingId: fakeId(t["id"], "recording"),
            // legacy lowercase fields for compatibility
            artistid: lidarr2["id"],
            durationms: (t["duration"] ?? 0) * 1000,
            id: fakeId(t["id"], "track"),
            mediumnumber: t["disk_number"] || 1,
            oldids: [],
            oldrecordingids: [],
            recordingid: fakeId(t["id"], "recording"),
            trackname: t["title"],
            tracknumber: `${t["track_position"] ?? idx + 1}`,
            trackposition: t["track_position"] ?? idx + 1,
          })),
        },
      ],
      secondarytypes: getSecondaryTypes(d["title"], d["record_type"]),
      title: d["title"],
      type: mapRecordType(d["record_type"]).type,
    };
  } catch (error) {
    console.error("Error getting album:", error);
    return null;
  }
}

function toAlbumDto(a: any) {
  return {
    Id: fakeId(a["id"], "album"),
    OldIds: [],
    ReleaseStatuses: ["Official"],
    SecondaryTypes: getSecondaryTypes(a["title"], a["record_type"]),
    Title: a["title"],
    Type: mapRecordType(a["record_type"]).type,
  };
}

export async function getAlbums(name: string, deezerId?: string | number) {
  try {
    const dalbums = await deemixAlbums(name, deezerId);

    // smart dedupe: picks the "best" album when there are duplicates
    const dedupedAlbums = deduplicateAlbums(dalbums);

    return dedupedAlbums.map(toAlbumDto);
  } catch (error) {
    console.error("Error getting albums:", error);
    return [];
  }
}

export async function search(
  lidarr: any[],
  query: string,
  isManual: boolean = true
): Promise<any[]> {
  // Ensure lidarr is always an array
  if (!Array.isArray(lidarr)) {
    lidarr = [];
  }
  
  const dartists = await searchDeemixArtists(query);

  let didx = -1;
  // mutated in place, so no write-back into lidarr is needed
  const lartist =
    process.env.OVERRIDE_MB !== "true"
      ? lidarr.find((artist) => artist["album"] === null)
      : undefined;
  if (lartist) {
    let dartist;
    for (const [i, d] of dartists.entries()) {
      if (normalize(lartist["artist"]["artistname"]) === normalize(d["name"])) {
        dartist = d;
        didx = i;
        break;
      }
    }
    if (dartist) {
      lartist["artist"]["images"] = lartist["artist"]["images"] || [];
      if (!lartist["artist"]["images"].some((i: any) => i["CoverType"] === "Poster")) {
        (lartist["artist"]["images"] as any[]).push({
          CoverType: "Poster",
          Url: dartist["picture_xl"],
        });
      }
      lartist["artist"]["oldids"] = lartist["artist"]["oldids"] || [];
      lartist["artist"]["oldids"].push(fakeId(dartist["id"], "artist"));
    }
  }

  if (didx > -1) {
    dartists.splice(didx, 1);
  }

  let dtolartists: any[] = dartists.map((d) => ({
    artist: {
      artistaliases: [],
      artistname: d["name"],
      sortname: sortName(d["name"]),
      genres: [],
      id: fakeId(d["id"], "artist"),
      images: [
        {
          CoverType: "Poster",
          Url: d["picture_xl"],
        },
      ],
      links: [
        {
          target: d["link"],
          type: "deezer",
        },
      ],
      type:
        ((d["type"] as string) || "artist").charAt(0).toUpperCase() +
        ((d["type"] as string) || "artist").slice(1),
    },
    album: null,
  }));

  // query is already decoded by Fastify - decoding again would throw
  // URIError on literal '%' in search terms
  if (lidarr.length === 0) {
    const sorted = [];

    for (const a of dtolartists) {
      if (normalize(a.artist.artistname) === normalize(query)) {
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
      const exact = dtolartists.filter(
        (a) => normalize(a["artistname"]) === normalize(query)
      );
      dtolartists = exact.length > 0 ? [exact[0]] : [];
    }
  }

  lidarr = [...lidarr, ...dtolartists];

  if (process.env.OVERRIDE_MB === "true") {
    lidarr = dtolartists;
  }

  return lidarr;
}

async function getArtistByName(name: string) {
  const artists = await searchDeemixArtists(name);
  return artists.find((a) => normalize(a["name"]) === normalize(name));
}

export async function getArtist(lidarr: any) {
  try {
    if (lidarr["error"]) return lidarr;
    lidarr["images"] ??= [];
    lidarr["Albums"] ??= [];
    const artist = await getArtistByName(lidarr["artistname"]);
    if (typeof artist === "undefined") {
      return lidarr;
    }
    if (!lidarr["images"].some((i: any) => i["CoverType"] === "Poster")) {
      (lidarr["images"] as any[]).push({
        CoverType: "Poster",
        Url: artist!["picture_xl"],
      });
    }

    const albums = await getAlbums(lidarr["artistname"], artist["id"]);

    let existing = lidarr["Albums"].map((a: any) => normalize(a["Title"]));
    if (process.env.PRIO_DEEMIX === "true") {
      existing = albums.map((a: any) => normalize(a["Title"]));
    }
    if (process.env.OVERRIDE_MB === "true") {
      lidarr["images"] = [
        {
          CoverType: "Poster",
          Url: artist!["picture_xl"],
        },
      ];
      lidarr["Albums"] = albums;
    } else {
      if (process.env.PRIO_DEEMIX === "true") {
        lidarr["Albums"] = [
          ...lidarr["Albums"].filter(
            (a: any) => !existing.includes(normalize(a["Title"]))
          ),
          ...albums,
        ];
      } else {
        lidarr["Albums"] = [
          ...lidarr["Albums"],
          ...albums.filter((a) => !existing.includes(normalize(a["Title"]))),
        ];
      }
    }

    return lidarr;
  } catch (error) {
    console.error("Error getting artist:", error);
    return lidarr;
  }
}