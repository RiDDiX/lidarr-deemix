import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion, die Fehler beim Abruf von der Deemix-API abfängt
async function safeDeemixFetch(path: string): Promise<any> {
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

// Erstellt eine eindeutige, aber "falsche" MBID, damit Lidarr die Deemix-Einträge verarbeiten kann
function fakeId(id: any, type: string): string {
  let p = "a"; // artist
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  
  id = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${id}`;
}

// Extrahiert die echte Deemix-ID aus unserer Fake-ID
function getRealDeemixId(fakeArtistId: string): string {
    const idPart = fakeArtistId.split('-')[4];
    return idPart ? idPart.replace(/^[a-z]+/, '') : '';
}

// Sucht nach Künstlern auf Deemix
async function searchDeemixArtists(name: string): Promise<any[]> {
  const data = await safeDeemixFetch(`/search/artists?limit=25&q=${encodeURIComponent(name)}`);
  return data?.data || [];
}

// Holt die Tracks für ein bestimmtes Album
async function getDeemixTracks(albumId: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/album/${albumId}/tracks`);
    return data?.data || [];
}

/**
 * Erstellt ein vollständiges Künstler-Objekt aus Deemix-Daten, das mit Lidarr kompatibel ist.
 * Dies ist die Schlüsselfunktion, um das Hinzufügen zu ermöglichen.
 */
export async function getDeemixArtistById(fakeArtistId: string): Promise<any | null> {
    const deemixId = getRealDeemixId(fakeArtistId);
    if (!deemixId) return null;

    const artistData = await safeDeemixFetch(`/artists/${deemixId}`);
    if (!artistData) return null;

    const artistForAlbum = {
      id: fakeId(artistData.id, "artist"),
      artistname: artistData.name,
      foreignArtistId: fakeId(artistData.id, "artist"),
      sortname: artistData.name,
      status: "active",
      type: "Artist",
    };

    const albumsData = await Promise.all((artistData.albums?.data || []).map(async (album: any) => {
        return getAlbumStructure(album.id, artistForAlbum);
    }));

    return {
      id: fakeId(artistData.id, "artist"),
      foreignArtistId: fakeId(artistData.id, "artist"),
      artistname: artistData.name,
      sortname: artistData.name,
      disambiguation: `Deemix ID: ${artistData.id}`,
      overview: `Von Deemix importierter Künstler. ID: ${artistData.id}`,
      artistaliases: [],
      images: [{ CoverType: "Poster", Url: artistData.picture_xl }],
      Albums: albumsData.filter(Boolean), // Filtere null-Werte heraus
      genres: [],
      links: [],
      status: "active",
      type: "Artist",
      oldids: [],
      OldForeignArtistIds: [],
    };
}

/**
 * Holt die Daten für ein einzelnes Album und formatiert sie für Lidarr.
 */
export async function getAlbumById(fakeAlbumId: string): Promise<any | null> {
    const albumId = getRealDeemixId(fakeAlbumId);
    if (!albumId) return null;
    
    const albumDetails = await safeDeemixFetch(`/albums/${albumId}`);
    if (!albumDetails || !albumDetails.artist) return null;
    
    // Wir benötigen die Künstlerinformationen für das Albumobjekt
    const artistForAlbum = {
        id: fakeId(albumDetails.artist.id, "artist"),
        artistname: albumDetails.artist.name,
        foreignArtistId: fakeId(albumDetails.artist.id, "artist"),
        sortname: albumDetails.artist.name,
        status: "active",
        type: "Artist",
    };

    return getAlbumStructure(albumId, artistForAlbum);
}


/**
 * Helper-Funktion, um eine konsistente Album-Struktur zu erstellen.
 */
async function getAlbumStructure(albumId: string, artistForAlbum: any): Promise<any | null> {
    const albumDetails = await safeDeemixFetch(`/albums/${albumId}`);
    if (!albumDetails) return null;

    const title = titleCase(albumDetails.title || "Unbekanntes Album");
    const tracks = await getDeemixTracks(albumDetails.id) || [];
      
    return {
        Id: fakeId(albumDetails.id, "album"),
        Title: title,
        LowerTitle: normalize(title),
        artistid: artistForAlbum.id,
        artists: [artistForAlbum], // Entscheidender Fix: Lidarr braucht diese Info hier!
        ReleaseStatuses: ["Official"],
        SecondaryTypes: albumDetails.record_type === 'ep' ? ['EP'] : (title.toLowerCase().includes("live") ? ["Live"] : []),
        Type: albumDetails.record_type === 'ep' ? 'EP' : titleCase(albumDetails.record_type || 'album'),
        disambiguation: `Deemix ID: ${albumDetails.id}`,
        overview: `Von Deemix importiertes Album. ID: ${albumDetails.id}`,
        images: [{ CoverType: "Cover", Url: albumDetails.cover_xl }],
        releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
        releases: [{
            Id: fakeId(albumDetails.id, "release"),
            Title: title,
            track_count: tracks.length,
            country: ["Worldwide"],
            status: "Official",
            disambiguation: "",
            label: [albumDetails.label || "Unbekanntes Label"],
            oldids: [],
            releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
            media: _.uniqBy(tracks, "disk_number").map((t: any) => ({
              Format: "Digital Media",
              Name: "",
              Position: t.disk_number || 1,
            })),
            tracks: tracks.map((track: any, idx: number) => ({
                artistid: artistForAlbum.id,
                durationms: (track.duration || 0) * 1000,
                id: fakeId(track.id, "track"),
                mediumnumber: track.disk_number || 1,
                oldids: [],
                oldrecordingids: [],
                recordingid: fakeId(track.id, "recording"),
                trackname: track.title || "Unbekannter Track",
                tracknumber: `${idx + 1}`,
                trackposition: idx + 1,
            })),
        }],
    };
}


/**
 * Führt Suchergebnisse von Lidarr (MusicBrainz) und Deemix zusammen.
 */
export async function search(lidarrResults: any[], query: string): Promise<any[]> {
  const deemixArtists = await searchDeemixArtists(query);
  const existingLidarrNames = new Set(lidarrResults.map(item => normalize(item?.artist?.artistname || '')));
  
  const deemixFormattedResults = [];

  for (const d of deemixArtists) {
    // Füge nur Künstler hinzu, die nicht schon von Lidarr/MusicBrainz gefunden wurden
    if (existingLidarrNames.has(normalize(d.name))) {
        continue;
    }
    
    deemixFormattedResults.push({
      artist: {
        id: fakeId(d.id, "artist"),
        foreignArtistId: fakeId(d.id, "artist"),
        artistname: d.name,
        sortname: d.name,
        images: [{ CoverType: "Poster", Url: d.picture_xl }],
        disambiguation: `Deemix ID: ${d.id}`,
        overview: `Von Deemix importierter Künstler. ID: ${d.id}`,
        artistaliases: [],
        genres: [],
        status: "active",
        type: "Artist"
      },
    });
  }

  // Kombiniere die Ergebnisse und gib sie zurück
  return [...lidarrResults, ...deemixFormattedResults];
}