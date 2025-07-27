import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase, mergeAlbumLists } from "./helpers.js";
import { getArtistData } from "./artistData.js";
import { getAllLidarrArtists } from "./lidarr.js";

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

// === DEINE URSPRÜNGLICHE, FUNKTIONIERENDE LOGIK, NUR STABIL GEMACHT ===
// Erzeugt eine stabile, wiedererkennbare Fake-ID basierend auf der Deemix-ID.
function createFakeArtistId(deemixId: number | string): string {
    const paddedId = `${deemixId}`.padStart(12, 'a');
    const fakeUuid = `aaaaaaaa-aaaa-aaaa-aaaa-${paddedId}`;
    return fakeUuid;
}

function createFakeAlbumId(deemixId: number | string): string {
    const paddedId = `${deemixId}`.padStart(12, 'b');
    const fakeUuid = `bbbbbbbb-bbbb-bbbb-bbbb-${paddedId}`;
    return fakeUuid;
}

// Extrahiert die echte Deemix-ID aus unserer Fake-ID
function getRealDeemixId(fakeId: string): string {
    return fakeId.split('-')[4].replace(/^a+/, '').replace(/^b+/, '');
}


export async function deemixArtists(name: string): Promise<any[]> {
  const json = await safeDeemixFetch(`/search/artists?limit=50&offset=0&q=${encodeURIComponent(name)}`);
  return json?.data || [];
}

export async function deemixAlbum(id: string): Promise<any> {
  return await safeDeemixFetch(`/albums/${id}`);
}

export async function deemixAlbums(artistName: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/search/albums?limit=200&offset=0&q=${encodeURIComponent(artistName)}`);
    const albums = data?.data || [];
    return albums
        .filter((a: any) => normalize(a?.artist?.name || "") === normalize(artistName))
        .map((d: any) => ({
            Id: createFakeAlbumId(d.id),
            Title: titleCase(d.title),
            ReleaseStatuses: ["Official"],
            SecondaryTypes: d.title.toLowerCase().includes("live") ? ["Live"] : [],
            Type: d.record_type === 'ep' ? 'EP' : titleCase(d.record_type || 'album'),
        }));
}

// Holt die vollen Künstlerdaten von Deemix anhand einer ECHTEN Deemix-ID
export async function getDeemixArtistById(deemixId: string): Promise<any> {
    const j = await safeDeemixFetch(`/artists/${deemixId}`);
    if (!j) return null;

    const albumsData = (j.albums?.data || []).map((a: any) => ({
        Id: createFakeAlbumId(a.id),
        Title: titleCase(a.title),
        ReleaseStatuses: ["Official"],
        SecondaryTypes: a.title.toLowerCase().includes("live") ? ["Live"] : [],
        Type: a.record_type === 'ep' ? 'EP' : titleCase(a.record_type || 'album'),
    }));

    return {
      id: createFakeArtistId(j.id), // Gib die Fake-ID zurück, die Lidarr erwartet
      foreignArtistId: createFakeArtistId(j.id), // Wichtig für die Verknüpfung
      artistname: j.name, // Der korrekte Name
      sortname: j.name.split(" ").reverse().join(", "),
      disambiguation: `Deemix ID: ${j.id}`,
      overview: `Von Deemix importierter Künstler.`,
      artistaliases: [],
      images: [{ CoverType: "Poster", Url: j.picture_xl }],
      Albums: albumsData,
      // Fülle weitere Pflichtfelder, die Lidarr eventuell braucht
      genres: [],
      links: [],
      status: "active",
      type: "Artist",
    };
}

// Sucht und kombiniert die Ergebnisse
export async function search(lidarr: any[], query: string): Promise<any[]> {
  const deemixArtistsList = await deemixArtists(query);
  const existingLidarrNames = new Set(lidarr.map(item => normalize(item?.artist?.artistname || '')));
  const deemixResults = [];

  for (const dArtist of deemixArtistsList) {
    if (existingLidarrNames.has(normalize(dArtist.name))) {
        continue; // Überspringe, wenn Lidarr/MusicBrainz den Künstler schon hat
    }
    
    // Künstler existiert nur auf Deemix, erstelle einen sauberen Eintrag
    deemixResults.push({
      artist: {
        id: createFakeArtistId(dArtist.id),
        foreignArtistId: createFakeArtistId(dArtist.id),
        artistname: dArtist.name, // Der korrekte Name
        sortname: dArtist.name.split(" ").reverse().join(", "),
        images: [{ CoverType: "Poster", Url: dArtist.picture_xl }],
        // Fülle alle anderen Felder, die in der Suche angezeigt werden sollen
        disambiguation: `Deemix ID: ${dArtist.id}`,
        artistaliases: [],
        genres: [],
        status: "active",
      },
    });
  }

  return [...lidarr, ...deemixResults];
}