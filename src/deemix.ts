import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion, die Fehler abfängt
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

// Deine bewährte, stabile Fake-ID-Logik
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
    const idPart = fakeId.split('-')[4];
    return idPart ? idPart.replace(/^[a-z]+/, '') : '';
}

async function deemixArtists(name: string): Promise<any[]> {
  const data = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
  return data?.data || [];
}

async function getDeemixTracks(albumId: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/album/${albumId}/tracks`);
    return data?.data || []; // Stellt sicher, dass immer ein Array zurückgegeben wird
}

// Baut ein vollständiges und für Lidarr valides Künstler-Objekt aus Deemix-Daten
export async function getDeemixArtistById(deemixId: string): Promise<any> {
    const j = await safeDeemixFetch(`/artists/${deemixId}`);
    if (!j) return null;

    const albumsData = await Promise.all((j.albums?.data || []).map(async (a: any) => {
      const title = titleCase(a.title);
      // === DER ALLERLETZTE, ENTSCHEIDENDE FIX ===
      // Wir stellen sicher, dass 'tracks' IMMER ein Array ist, auch wenn die API nichts liefert.
      const tracks = await getDeemixTracks(a.id) || [];
      
      return {
        Id: fakeId(a.id, "album"),
        Title: title,
        LowerTitle: normalize(title),
        ReleaseStatuses: ["Official"],
        SecondaryTypes: title.toLowerCase().includes("live") ? ["Live"] : [],
        Type: a.record_type === 'ep' ? 'EP' : titleCase(a.record_type || 'album'),
        releases: [{
            Id: fakeId(a.id, "release"),
            Title: title,
            track_count: tracks.length,
            country: ["Worldwide"],
            status: "Official",
            media: _.uniqBy(tracks, "disk_number").map((t: any) => ({
              Format: "Digital Media",
              Name: "",
              Position: t.disk_number,
              track_count: tracks.filter(tr => tr.disk_number === t.disk_number).length,
              tracks: tracks.filter(tr => tr.disk_number === t.disk_number).map((track: any) => ({
                  artistid: fakeId(j.id, "artist"),
                  durationms: track.duration * 1000,
                  id: fakeId(track.id, "track"),
                  mediumnumber: track.disk_number,
                  oldids: [],
                  oldrecordingids: [],
                  recordingid: fakeId(track.id, "recording"),
                  trackname: track.title,
                  tracknumber: `${track.track_position}`,
                  trackposition: track.track_position,
              })),
            })),
        }],
      };
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
      OldForeignArtistIds: [],
      oldids: [],
    };
}

// Sucht und kombiniert die Ergebnisse für die Benutzeroberfläche
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