import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase, mergeAlbumLists } from "./helpers.js";
import { getArtistData } from "./artistData.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion für die interne Deemix-API
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

// Deine originale, funktionierende ID-Logik
function fakeId(id: any, type: string) {
  let p = "a";
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  id = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${id}`;
}

// Extrahiert die echte Deemix-ID aus unserer Fake-ID
export function getRealDeemixId(fakeId: string): string {
    return fakeId.split('-')[4].replace(/^a+/, '').replace(/^b+/, '');
}

async function deemixArtists(name: string): Promise<any[]> {
  const data = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  return data?.data || [];
}

async function getDeemixAlbums(artistName: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/search/albums?limit=200&offset=0&q=${encodeURIComponent(artistName)}`);
    const albums = data?.data || [];
    return albums
        .filter((a: any) => normalize(a?.artist?.name || "") === normalize(artistName))
        .map((d: any) => ({
            Id: fakeId(d.id, "album"),
            Title: titleCase(d.title),
            ReleaseStatuses: ["Official"],
            SecondaryTypes: d.title.toLowerCase().includes("live") ? ["Live"] : [],
            Type: d.record_type === 'ep' ? 'EP' : titleCase(d.record_type || 'album'),
        }));
}

// Baut ein vollständiges Künstler-Objekt aus Deemix-Daten
export async function getDeemixArtistById(deemixId: string): Promise<any> {
    const j = await safeDeemixFetch(`/artists/${deemixId}`);
    if (!j) return null;

    const albumsData = (j.albums?.data || []).map((a: any) => ({
        Id: fakeId(a.id, "album"),
        Title: titleCase(a.title),
        ReleaseStatuses: ["Official"],
        SecondaryTypes: a.title.toLowerCase().includes("live") ? ["Live"] : [],
        Type: a.record_type === 'ep' ? 'EP' : titleCase(a.record_type || 'album'),
    }));

    return {
      id: fakeId(j.id, "artist"),
      foreignArtistId: fakeId(j.id, "artist"),
      artistname: j.name,
      sortname: j.name.split(" ").reverse().join(", "),
      disambiguation: `Deemix ID: ${j.id}`,
      overview: "Von Deemix importierter Künstler.",
      artistaliases: [],
      images: [{ CoverType: "Poster", Url: j.picture_xl }],
      Albums: albumsData,
      genres: [],
      links: [],
      status: "active",
      type: "Artist",
      // === DER FINALE FIX, DER ALLES REPARIERT ===
      OldForeignArtistIds: [],
      oldids: [],
    };
}

// Kombiniert Lidarr/MB- und Deemix-Ergebnisse
export async function search(lidarr: any[], query: string): Promise<any[]> {
  const dartists = await deemixArtists(query);
  const existingLidarrNames = new Set(lidarr.map(item => normalize(item?.artist?.artistname || '')));
  const deemixResults = [];

  for (const d of dartists) {
    if (existingLidarrNames.has(normalize(d.name))) {
        continue;
    }
    
    deemixResults.push({
      artist: {
        id: fakeId(d.id, "artist"),
        foreignArtistId: fakeId(d.id, "artist"),
        artistname: d.name,
        sortname: (d.name as string).split(" ").reverse().join(", "),
        images: [{ CoverType: "Poster", Url: d.picture_xl }],
        disambiguation: `Deemix ID: ${d.id}`,
        artistaliases: [],
        genres: [],
        status: "active",
      },
    });
  }

  return [...lidarr, ...deemixResults];
}