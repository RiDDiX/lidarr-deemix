import _ from "lodash";
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

export function isFakeId(id: string | undefined | null, type: DeemixEntityType): boolean {
  if (!id) return false;
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
  return suffix.replace(new RegExp(`^${prefix}+`), "") || null;
}

async function fetchWithTimeout(url: string, timeout = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function searchDeemixArtists(name: string): Promise<any[]> {
  try {
    const data = await fetchWithTimeout(
      `${DEEMIX_URL}/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`
    );
    if (!data.ok) {
      console.error(`Deemix artist search failed: ${data.status}`);
      return [];
    }
    const j = (await data.json()) as any;
    return Array.isArray(j["data"]) ? j["data"] : [];
  } catch (error) {
    console.error("Error searching Deemix artists:", error);
    return [];
  }
}

export async function deemixAlbum(id: string): Promise<any> {
  try {
    const data = await fetchWithTimeout(`${DEEMIX_URL}/albums/${id}`);
    if (!data.ok) {
      console.error(`Deemix album fetch failed: ${data.status}`);
      return null;
    }
    const j = (await data.json()) as any;
    return j;
  } catch (error) {
    console.error("Error fetching Deemix album:", error);
    return null;
  }
}

// Returns null on failure (network, HTTP error, bad payload) so callers can
// tell "no tracks" apart from "tracks unavailable right now"
export async function deemixTracks(id: string): Promise<any[] | null> {
  try {
    const data = await fetchWithTimeout(`${DEEMIX_URL}/album/${id}/tracks`);
    if (!data.ok) {
      console.error(`Deemix tracks fetch failed: ${data.status}`);
      return null;
    }
    const j = (await data.json()) as any;
    return Array.isArray(j?.data) ? j.data : null;
  } catch (error) {
    console.error("Error fetching Deemix tracks:", error);
    return null;
  }
}

export async function deemixArtist(id: string): Promise<any> {
  try {
    const data = await fetchWithTimeout(`${DEEMIX_URL}/artists/${id}`);
    if (!data.ok) {
      console.error(`Deemix artist fetch failed: ${data.status}`);
      return null;
    }
    const j = (await data.json()) as any;

    const artistAlbums: any[] = Array.isArray(j?.["albums"]?.["data"])
      ? j["albums"]["data"]
      : [];

    return {
      Albums: [
        ...artistAlbums.map((a: any) => ({
          Id: fakeId(a["id"], "album"),
          OldIds: [],
          ReleaseStatuses: ["Official"],
          SecondaryTypes: getSecondaryTypes(a["title"], a["record_type"]),
          Title: a["title"],
          Type: mapRecordType(a["record_type"]).type,
        })),
      ],
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
  } catch (error) {
    console.error("Error fetching Deemix artist:", error);
    return null;
  }
}

// Deezer's account for compilations ("Various Artists" / "Verschillende artiesten" /
// "Verschiedene Interpreten" - the name is locale-dependent, the id is not)
const DEEZER_VARIOUS_ARTISTS_ID = 5080;

async function deemixAlbums(name: string): Promise<any[]> {
  try {
    let total = 0;
    let start = 0;
    const parsedMax = parseInt(process.env.DEEMIX_MAX_ALBUMS || "500");
    const maxAlbums = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 500;
    const data = await fetchWithTimeout(
      `${DEEMIX_URL}/search/albums?limit=1&offset=0&q=${encodeURIComponent(name)}`
    );

    if (!data.ok) {
      console.error(`Deemix albums search failed: ${data.status}`);
      return [];
    }

    const j = (await data.json()) as any;
    total = Math.min((j["total"] as number) || 0, maxAlbums);

    const albums: any[] = [];
    while (start < total) {
      const data = await fetchWithTimeout(
        `${DEEMIX_URL}/search/albums?limit=100&offset=${start}&q=${encodeURIComponent(name)}`
      );
      if (!data.ok) {
        console.error(`Deemix albums batch fetch failed: ${data.status}`);
        break;
      }
      const j = (await data.json()) as any;
      const batch = Array.isArray(j?.data) ? j.data : [];
      if (batch.length === 0) break;
      albums.push(...batch);
      start += 100;
    }

    return albums.filter(
      (a) =>
        normalize(a?.["artist"]?.["name"] || "") === normalize(name) ||
        a?.["artist"]?.["id"] === DEEZER_VARIOUS_ARTISTS_ID
    );
  } catch (error) {
    console.error("Error fetching Deemix albums:", error);
    return [];
  }
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
  // Word boundary avoids false positives like "Oliver" or "Deliverance"
  if (/\blive\b/i.test(title || "")) {
    secondary.push("Live");
  }
  return secondary;
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
      sortname: (c["name"] as string).split(" ").reverse().join(", "),
      status: "active",
      type: "Artist",
    })) || [];

    const lidarrArtists = await getAllLidarrArtists();

    let lidarr: any = null;
    let deemixMatch: any = null;

    for (const la of lidarrArtists) {
      for (const c of contributors) {
        if (
          la["artistName"] === c["artistname"] ||
          normalize(la["artistName"]) === normalize(c["artistname"])
        ) {
          lidarr = la;
          deemixMatch = c;
          break;
        }
      }
      if (lidarr) break;
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
            sortname: (d["artist"]["name"] as string)
              .split(" ")
              .reverse()
              .join(", "),
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
      sortname:
        artist["sortname"] ||
        (artist["artistname"] as string)
          .split(" ")
          .reverse()
          .join(", "),
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
        sortname: (lidarr["artistName"] as string)
          .split(" ")
          .reverse()
          .join(", "),
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
      id: `${fakeId(d["id"], "album")}`,
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
          id: `${fakeId(d["id"], "release")}`,
          label: [d["label"]],
          media: _.uniqBy(tracks, "disk_number").map((t: any) => ({
            Format: "CD",
            Name: "",
            Position: t["disk_number"],
          })),
          oldids: [],
          releasedate: d["release_date"],
          status: "Official",
          title: d["title"],
          tracks: tracks.map((t: any, idx: number) => ({
            // PascalCase - that's what Lidarr expects here
            Id: `${fakeId(t["id"], "track")}`,
            ArtistCredit: [],
            Title: t["title"],
            // Deezer's album-tracks payload uses track_position (not track_number)
            TrackPosition: t["track_position"] ?? idx + 1,
            MediumNumber: t["disk_number"] || 1,
            Duration: t["duration"] * 1000,
            RecordingId: fakeId(t["id"], "recording"),
            // legacy lowercase fields for compatibility
            artistid: lidarr2["id"],
            durationms: t["duration"] * 1000,
            id: `${fakeId(t["id"], "track")}`,
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

export async function getAlbums(name: string) {
  try {
    const dalbums = await deemixAlbums(name);

    // smart dedupe: picks the "best" album when there are duplicates
    const dedupedAlbums = deduplicateAlbums(dalbums);

    const dtoRalbums = dedupedAlbums.map((d) => ({
      Id: `${fakeId(d["id"], "album")}`,
      OldIds: [],
      ReleaseStatuses: ["Official"],
      SecondaryTypes: getSecondaryTypes(d["title"], d["record_type"]),
      Title: d["title"],
      Type: mapRecordType(d["record_type"]).type,
    }));

    return dtoRalbums;
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
  
  let dartists: any[] = [];
  try {
    dartists = await searchDeemixArtists(query);
  } catch (error) {
    console.error("Deemix artist search failed, continuing with Lidarr data only:", error);
  }

    let lartist;
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
      let dartist;
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
        lartist["artist"]["images"] = lartist["artist"]["images"] || [];
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
        lartist["artist"]["oldids"] = lartist["artist"]["oldids"] || [];
        lartist["artist"]["oldids"].push(fakeId(dartist["id"], "artist"));
      }

      lidarr[lidx] = lartist;
    }

    if (didx > -1) {
      dartists.splice(didx, 1);
    }

    let dtolartists: any[] = dartists.map((d) => ({
      artist: {
        artistaliases: [],
        artistname: d["name"],
        sortname: (d["name"] as string).split(" ").reverse().join(", "),
        genres: [],
        id: `${fakeId(d["id"], "artist")}`,
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
        if (
          a.artist.artistname === query ||
          normalize(a.artist.artistname) === normalize(query)
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
        const exact = dtolartists.filter((a) => {
          return (
            a["artistname"] === query ||
            normalize(a["artistname"]) === normalize(query)
          );
        });
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
  try {
    const artists = await searchDeemixArtists(name);
    const artist = artists.find(
      (a) => a["name"] === name || normalize(a["name"]) === normalize(name)
    );
    return artist;
  } catch (error) {
    console.error("Error getting artist by name:", error);
    return undefined;
  }
}

export async function getArtist(lidarr: any) {
  try {
    if (lidarr["error"]) return lidarr;
    const artist = await getArtistByName(lidarr["artistname"]);
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
        Url: artist!["picture_xl"],
      });
    }

    const albums = await getAlbums(lidarr["artistname"]);

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