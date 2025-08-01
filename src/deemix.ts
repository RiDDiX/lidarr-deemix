import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

async function safeDeemixFetch(path: string): Promise<any> {
    try {
        const res = await fetch(`${deemixUrl}${path}`);
        if (!res.ok) {
            console.warn(`Deemix-Server antwortete mit Fehler ${res.status} für: ${path}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(`Fehler bei der Verbindung zum Deemix-Server für: ${path}`, e);
        return null;
    }
}

export function fakeId(id: any, type: string): string {
  let p = "a";
  if (type === "album") p = "b";
  if (type === "track") p = "c";
  if (type === "release") p = "d";
  if (type === "recording") p = "e";
  id = `${id}`.padStart(12, p);
  return `${"".padStart(8, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${"".padStart(4, p)}-${id}`;
}

function getRealDeemixId(fakeId: string): string {
    const idPart = fakeId.split('-')[4];
    return idPart ? idPart.replace(/^[a-z]+/, '') : '';
}

export async function searchDeemixArtists(name: string): Promise<any[]> {
  const data = await safeDeemixFetch(`/search/artists?limit=25&q=${encodeURIComponent(name)}`);
  return data?.data || [];
}

async function getDeemixTracks(albumId: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/album/${albumId}/tracks`);
    return data?.data || [];
}

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
    
    // === KORREKTUR DES BUILD-FEHLERS ===
    // Dem Parameter 'album' wurde explizit der Typ 'any' gegeben.
    const albumsData = await Promise.all(
        (artistData.albums?.data || []).map((album: any) => getAlbumStructure(album.id, artistForAlbum))
    );

    return {
      id: fakeId(artistData.id, "artist"),
      foreignArtistId: fakeId(artistData.id, "artist"),
      artistname: artistData.name,
      sortname: artistData.name,
      disambiguation: `Deemix ID: ${artistData.id}`,
      overview: `Von Deemix importierter Künstler. ID: ${artistData.id}`,
      artistaliases: [],
      images: [{ CoverType: "Poster", Url: artistData.picture_xl }],
      Albums: albumsData.filter(Boolean),
      genres: [], links: [], status: "active", type: "Artist",
      oldids: [], OldForeignArtistIds: [],
    };
}

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
        artists: [artistForAlbum],
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
            country: ["Worldwide"], status: "Official", disambiguation: "",
            label: [albumDetails.label || "Unbekanntes Label"],
            oldids: [],
            releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
            media: _.uniqBy(tracks, "disk_number").map((t: any) => ({ Format: "Digital Media", Name: "", Position: t.disk_number || 1 })),
            tracks: tracks.map((track: any, idx: number) => ({
                artistid: artistForAlbum.id,
                durationms: (track.duration || 0) * 1000,
                id: fakeId(track.id, "track"),
                mediumnumber: track.disk_number || 1,
                oldids: [], oldrecordingids: [],
                recordingid: fakeId(track.id, "recording"),
                trackname: track.title || "Unbekannter Track",
                tracknumber: `${idx + 1}`,
                trackposition: idx + 1,
            })),
        }],
    };
}