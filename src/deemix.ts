import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion mit Retry-Logik
async function safeDeemixFetch(path: string, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(`${deemixUrl}${path}`, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!res.ok) {
                console.warn(`Deemix-Server antwortete mit Status ${res.status} für Pfad: ${path}`);
                if (res.status === 404) return null;
                if (i === retries - 1) return null;
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                continue;
            }
            
            return await res.json();
        } catch (e) {
            console.error(`Versuch ${i + 1}/${retries} fehlgeschlagen für Pfad: ${path}`, e);
            if (i === retries - 1) return null;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    return null;
}

// Konsistente Fake-ID-Generierung
function fakeId(id: any, type: string): string {
    const prefixes: { [key: string]: string } = {
        artist: "a",
        album: "b", 
        track: "c",
        release: "d",
        recording: "e"
    };
    
    const prefix = prefixes[type] || "f";
    const paddedId = String(id).padStart(12, prefix);
    
    // Konsistentes UUID-Format
    return [
        "".padStart(8, prefix),
        "".padStart(4, prefix),
        "".padStart(4, prefix),
        "".padStart(4, prefix),
        paddedId
    ].join("-");
}

// Extrahiert die echte Deemix-ID aus unserer Fake-ID
export function getRealDeemixId(fakeId: string): string {
    if (!fakeId || typeof fakeId !== 'string') return '';
    const parts = fakeId.split('-');
    if (parts.length !== 5) return '';
    const idPart = parts[4];
    return idPart ? idPart.replace(/^[a-z]+/, '') : '';
}

// Suche nach Künstlern
async function deemixArtists(name: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
    return data?.data || [];
}

// Hole Album-Tracks
async function getDeemixTracks(albumId: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/album/${albumId}/tracks`);
    return data?.data || [];
}

// Hole vollständige Album-Details
async function getDeemixAlbum(albumId: string): Promise<any> {
    return await safeDeemixFetch(`/albums/${albumId}`);
}

// Baut ein vollständiges Künstler-Objekt für Lidarr
export async function getDeemixArtistById(deemixId: string): Promise<any> {
    if (!deemixId) {
        console.error("Keine Deemix-ID angegeben");
        return null;
    }

    console.log(`Hole Deemix-Künstler mit ID: ${deemixId}`);
    const artistData = await safeDeemixFetch(`/artists/${deemixId}`);
    
    if (!artistData) {
        console.error(`Künstler mit ID ${deemixId} nicht gefunden`);
        return null;
    }

    // Basis-Künstler-Objekt erstellen
    const artistId = fakeId(artistData.id, "artist");
    const baseArtist = {
        id: artistId,
        artistid: artistId,
        artistname: artistData.name,
        foreignArtistId: artistId,
        sortname: artistData.name.split(" ").reverse().join(", "),
        disambiguation: `Deemix ID: ${artistData.id}`,
        overview: `Künstler von Deezer/Deemix importiert. Original-ID: ${artistData.id}`,
        status: "active",
        type: "Artist"
    };

    // Alben parallel laden für bessere Performance
    const albumPromises = (artistData.albums?.data || []).map(async (albumSummary: any) => {
        try {
            const albumDetails = await getDeemixAlbum(albumSummary.id);
            if (!albumDetails) {
                console.warn(`Album ${albumSummary.id} konnte nicht geladen werden`);
                return null;
            }

            const tracks = await getDeemixTracks(albumSummary.id);
            const albumId = fakeId(albumDetails.id, "album");
            const releaseId = fakeId(albumDetails.id, "release");
            const title = titleCase(albumDetails.title || "Unknown Album");
            
            // Album-Typ bestimmen
            let albumType = "Album";
            if (albumDetails.record_type) {
                const recordType = albumDetails.record_type.toLowerCase();
                if (recordType === 'ep') albumType = "EP";
                else if (recordType === 'single') albumType = "Single";
                else if (recordType === 'compilation') albumType = "Compilation";
                else albumType = titleCase(recordType);
            }

            // Secondary Types bestimmen
            const secondaryTypes = [];
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes("live")) secondaryTypes.push("Live");
            if (lowerTitle.includes("remix")) secondaryTypes.push("Remix");
            if (lowerTitle.includes("deluxe")) secondaryTypes.push("Deluxe");
            if (lowerTitle.includes("acoustic")) secondaryTypes.push("Acoustic");

            return {
                Id: albumId,
                Title: title,
                LowerTitle: normalize(title),
                ReleaseStatuses: ["Official"],
                SecondaryTypes: secondaryTypes,
                Type: albumType,
                
                // KRITISCH: Künstler-Infos müssen auf Album-Ebene vorhanden sein
                artistid: artistId,
                artists: [baseArtist],
                
                // Release-Informationen
                releases: [{
                    Id: releaseId,
                    Title: title,
                    track_count: tracks.length,
                    country: ["Worldwide"],
                    status: "Official",
                    disambiguation: "",
                    label: [albumDetails.label || "Unknown Label"],
                    oldids: [],
                    releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                    
                    // Media-Informationen
                    media: _.uniqBy(tracks, "disk_number").map((t: any) => ({
                        Format: "Digital Media",
                        Name: `CD${t.disk_number || 1}`,
                        Position: t.disk_number || 1,
                        track_count: tracks.filter((tr: any) => tr.disk_number === (t.disk_number || 1)).length
                    })),
                    
                    // Track-Informationen
                    tracks: tracks.map((track: any, idx: number) => ({
                        artistid: artistId,
                        artists: [baseArtist],
                        durationms: (track.duration || 180) * 1000, // Fallback auf 3 Minuten
                        id: fakeId(track.id, "track"),
                        mediumnumber: track.disk_number || 1,
                        oldids: [],
                        oldrecordingids: [],
                        recordingid: fakeId(track.id, "recording"),
                        trackname: track.title || `Track ${idx + 1}`,
                        tracknumber: String(track.track_position || idx + 1),
                        trackposition: track.track_position || idx + 1,
                    }))
                }]
            };
        } catch (error) {
            console.error(`Fehler beim Verarbeiten von Album ${albumSummary.id}:`, error);
            return null;
        }
    });

    const albums = (await Promise.all(albumPromises)).filter(Boolean);

    // Vollständiges Künstler-Objekt zurückgeben
    return {
        ...baseArtist,
        artistaliases: [],
        images: artistData.picture_xl ? [
            { CoverType: "Poster", Url: artistData.picture_xl },
            { CoverType: "Fanart", Url: artistData.picture_xl },
            { CoverType: "Banner", Url: artistData.picture_medium || artistData.picture_xl }
        ] : [],
        Albums: albums,
        genres: [],
        links: artistData.link ? [{ name: "Deezer", url: artistData.link }] : [],
        OldForeignArtistIds: [],
        oldids: [],
        ratings: { votes: 0, value: 0 },
        statistics: {
            albumCount: albums.length,
            trackCount: albums.reduce((sum, album) => 
                sum + (album.releases?.[0]?.tracks?.length || 0), 0)
        }
    };
}

// Suche und kombiniere Ergebnisse
export async function search(lidarrResults: any[], query: string): Promise<any[]> {
    if (!query || query.trim().length === 0) {
        return lidarrResults;
    }

    console.log(`Suche nach: "${query}"`);
    
    const deemixArtists = await deemixArtists(query);
    const existingNames = new Set(
        lidarrResults
            .filter(item => item?.artist?.artistname)
            .map(item => normalize(item.artist.artistname))
    );
    
    const deemixResults = [];
    
    for (const artist of deemixArtists) {
        // Skip wenn bereits in Lidarr-Ergebnissen
        if (existingNames.has(normalize(artist.name))) {
            continue;
        }
        
        const artistId = fakeId(artist.id, "artist");
        
        deemixResults.push({
            artist: {
                id: artistId,
                artistid: artistId,
                foreignArtistId: artistId,
                artistname: artist.name,
                sortname: artist.name.split(" ").reverse().join(", "),
                images: artist.picture_xl ? [
                    { CoverType: "Poster", Url: artist.picture_xl }
                ] : [],
                disambiguation: `Deemix ID: ${artist.id}`,
                overview: `Von Deezer verfügbar`,
                artistaliases: [],
                genres: [],
                status: "active",
                type: "Artist",
                ratings: { votes: 0, value: 0 },
                statistics: { albumCount: artist.nb_album || 0, trackCount: 0 }
            }
        });
    }
    
    console.log(`Gefunden: ${lidarrResults.length} Lidarr, ${deemixResults.length} Deemix`);
    
    // Kombiniere Ergebnisse (Deemix zuerst wenn PRIO_DEEMIX gesetzt)
    if (process.env.PRIO_DEEMIX === "true") {
        return [...deemixResults, ...lidarrResults];
    }
    
    return [...lidarrResults, ...deemixResults];
}