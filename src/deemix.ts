import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";
import { getArtistData } from "./artistData.js";
import { mergeAlbumLists } from "./helpers.js";
import { getAllLidarrArtists } from "./lidarr.js";

// Verwende den richtigen Port: Standardmäßig auf 7272, falls DEEMIX_URL nicht in der Umgebung gesetzt ist.
const deemixUrl = process.env.DEEMIX_URL || "http://localhost:7272";

function fakeId(id: string | number, type: string): string {
  let p = "a";
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  const idStr = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${idStr}`;
}

export async function deemixArtists(name: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  const jsonRaw: unknown = await res.json();
  if (!jsonRaw || typeof jsonRaw !== "object") return [];
  const j = jsonRaw as any;
  return j["data"] as any[];
}

export async function deemixAlbum(id: string): Promise<any> {
  const res = await fetch(`${deemixUrl}/albums/${id}`);
  const j = await res.json();
  return j;
}

export async function deemixTracks(id: string): Promise<any[]> {
  const res = await fetch(`${deemixUrl}/album/${id}/tracks`);
  const j = await res.json();
  return j.data as any[];
}

export async function deemixArtist(idOrName: string): Promise<any> {
  // Wenn eine Ziffer vorkommt, nehmen wir an, es sei eine ID.
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
    const artist = artists.find(
      (a: any) => a["name"] === idOrName || normalize(a["name"]) === normalize(idOrName)
    );
    return artist ? artist : null;
  }
}

// Die weiteren Funktionen (deemixAlbums, getAlbum, search, getArtist) bleiben unverändert,
// da sie deine bestehende Logik abbilden. Falls hier Fehler auftreten, können diese ähnlich angepasst werden.
