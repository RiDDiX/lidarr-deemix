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

// Generiere MusicBrainz-kompatible UUID
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
    
    return [
        "".padStart(8, prefix),
        "".padStart(4, prefix),
        "".padStart(4, prefix),
        "".padStart(4, prefix),
        paddedId
    ].join("-");
}

// Extrahiert die echte Deemix-ID
export function getRealDeemixId(fakeId: string): string {
    if (!fakeId || typeof fakeId !== 'string') return '';
    const parts = fakeId.split('-');
    if (parts.length !== 5) return '';
    const idPart = parts[4];
    return idPart ? idPart.replace(/^[a-z]+/, '') : '';
}

// Suche nach Künstlern
async function searchDeemixArtists(name: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
    return data?.data || [];
}

// Hole Album-Tracks
async function getDeemixTracks(albumId: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/album/${albumId}/tracks`);
    return data?.data || [];
}

// Hole Album-Details
async function getDeemixAlbum(albumId: string): Promise<any> {
    return await safeDeemixFetch(`/albums/${albumId}`);
}

// HAUPTFUNKTION: Baut Künstler-Objekt für Lidarr
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

    const artistId = fakeId(artistData.id, "artist");
    const artistName = artistData.name || "Unknown Artist";
    
    // Lade und verarbeite Alben
    const albumPromises = (artistData.albums?.data || []).map(async (albumSummary: any) => {
        try {
            const albumDetails = await getDeemixAlbum(albumSummary.id);
            if (!albumDetails) return null;

            const tracks = await getDeemixTracks(albumSummary.id);
            if (!tracks || tracks.length === 0) return null;
            
            const albumId = fakeId(albumDetails.id, "album");
            const releaseId = fakeId(albumDetails.id, "release");
            const title = titleCase(albumDetails.title || "Unknown Album");
            
            // Album-Typ
            let albumType = "Album";
            const recordType = (albumDetails.record_type || "").toLowerCase();
            if (recordType === 'ep') albumType = "EP";
            else if (recordType === 'single') albumType = "Single";
            else if (recordType === 'compilation') albumType = "Compilation";
            
            // Secondary Types
            const secondaryTypes = [];
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes("live")) secondaryTypes.push("Live");
            if (lowerTitle.includes("remix")) secondaryTypes.push("Remix");
            
            // Media für Discs
            const discNumbers = _.uniq(tracks.map(t => t.disk_number || 1));
            const media = discNumbers.map(discNum => ({
                Format: "Digital Media",
                Name: "",
                Position: discNum
            }));

            // Track-Mapping
            const mappedTracks = tracks.map((track: any) => {
                const trackId = fakeId(track.id, "track");
                const recordingId = fakeId(track.id, "recording");
                
                return {
                    id: trackId,
                    recordingId: recordingId,
                    title: track.title || "Unknown Track",
                    trackPosition: track.track_position || 1,
                    mediumNumber: track.disk_number || 1,
                    duration: (track.duration || 180) * 1000
                };
            });

            // Album-Objekt (MusicBrainz-kompatibel)
            return {
                Id: albumId,
                Title: title,
                Type: albumType,
                SecondaryTypes: secondaryTypes,
                releases: [{
                    Id: releaseId,
                    Title: title,
                    status: "Official",
                    country: ["Worldwide"],
                    label: [albumDetails.label || ""],
                    format: "Digital Media",
                    releaseDate: albumDetails.release_date || "",
                    media: media,
                    tracks: mappedTracks
                }]
            };
        } catch (error) {
            console.error(`Fehler bei Album ${albumSummary.id}:`, error);
            return null;
        }
    });

    const albums = (await Promise.all(albumPromises)).filter(Boolean);

    // FINALES KÜNSTLER-OBJEKT (MusicBrainz API-kompatibel)
    return {
        id: artistId,
        foreignArtistId: artistId,
        artistName: artistName,
        sortName: artistName.split(" ").reverse().join(", "),
        disambiguation: "",
        overview: `Künstler importiert von Deezer (ID: ${artistData.id})`,
        status: "active",
        type: "Artist",
        images: artistData.picture_xl ? [{
            coverType: "Poster",
            url: artistData.picture_xl
        }] : [],
        links: [],
        genres: [],
        Albums: albums,
        oldForeignArtistIds: []
    };
}

// SUCHFUNKTION
export async function search(lidarrResults: any[], query: string): Promise<any[]> {
    if (!query || query.trim().length === 0) {
        return lidarrResults;
    }

    console.log(`Suche nach: "${query}"`);
    
    const deemixArtists = await searchDeemixArtists(query);
    const existingNames = new Set(
        lidarrResults
            .filter(item => item?.artist?.artistName)
            .map(item => normalize(item.artist.artistName))
    );
    
    const deemixResults = [];
    
    for (const artist of deemixArtists) {
        if (existingNames.has(normalize(artist.name))) {
            continue;
        }
        
        const artistId = fakeId(artist.id, "artist");
        
        deemixResults.push({
            artist: {
                id: artistId,
                foreignArtistId: artistId,
                artistName: artist.name,
                sortName: artist.name.split(" ").reverse().join(", "),
                disambiguation: "",
                overview: `Von Deezer verfügbar`,
                status: "active",
                type: "Artist",
                images: artist.picture_xl ? [{
                    coverType: "Poster",
                    url: artist.picture_xl
                }] : [],
                links: [],
                genres: []
            }
        });
    }
    
    console.log(`Gefunden: ${lidarrResults.length} Lidarr, ${deemixResults.length} Deemix`);
    
    if (process.env.PRIO_DEEMIX === "true") {
        return [...deemixResults, ...lidarrResults];
    }
    
    return [...lidarrResults, ...deemixResults];
}