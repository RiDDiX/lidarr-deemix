import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion
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
                console.warn(`Deemix-Server Status ${res.status} für: ${path}`);
                if (res.status === 404) return null;
                if (i === retries - 1) return null;
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                continue;
            }
            
            return await res.json();
        } catch (e) {
            console.error(`Versuch ${i + 1}/${retries} fehlgeschlagen:`, e);
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

// HAUPTFUNKTION: Baut Künstler für Lidarr
export async function getDeemixArtistById(deemixId: string): Promise<any> {
    if (!deemixId) {
        console.error("Keine Deemix-ID angegeben");
        return null;
    }

    console.log(`Lade Künstler von Deemix: ${deemixId}`);
    const artistData = await safeDeemixFetch(`/artists/${deemixId}`);
    
    if (!artistData) {
        console.error(`Künstler ${deemixId} nicht gefunden`);
        return null;
    }

    const artistId = fakeId(artistData.id, "artist");
    const artistName = artistData.name || "Unknown Artist";
    
    console.log(`Verarbeite Künstler: ${artistName} (${artistId})`);
    
    // Verarbeite Alben
    const albumsData = artistData.albums?.data || [];
    const albums = [];
    
    for (const albumSummary of albumsData) {
        try {
            console.log(`  Lade Album: ${albumSummary.title}`);
            
            const albumDetails = await getDeemixAlbum(albumSummary.id);
            if (!albumDetails) {
                console.warn(`  Album ${albumSummary.id} konnte nicht geladen werden`);
                continue;
            }

            const tracks = await getDeemixTracks(albumSummary.id);
            if (!tracks || tracks.length === 0) {
                console.warn(`  Album ${albumSummary.id} hat keine Tracks`);
                continue;
            }
            
            const albumId = fakeId(albumDetails.id, "album");
            const releaseId = fakeId(albumDetails.id, "release");
            const title = albumDetails.title || "Unknown Album";
            
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
            if (lowerTitle.includes("acoustic")) secondaryTypes.push("Acoustic");
            if (lowerTitle.includes("deluxe")) secondaryTypes.push("Deluxe");
            
            // Media
            const discNumbers = _.uniq(tracks.map(t => t.disk_number || 1)).sort();
            const media = discNumbers.map(discNum => ({
                Format: "Digital Media",
                Name: "",
                Position: discNum
            }));

            // WICHTIG: Tracks mit Artist-Credit für den Haupt-Künstler
            // Dies ist der FIX für den MapTrack-Fehler!
            const mappedTracks = tracks.map((track: any, idx: number) => {
                const trackNumber = track.track_position || (idx + 1);
                const discNumber = track.disk_number || 1;
                
                return {
                    // Track-IDs
                    id: fakeId(track.id, "track"),
                    recordingId: fakeId(track.id, "recording"),
                    
                    // Track-Info
                    title: track.title || `Track ${trackNumber}`,
                    
                    // Position
                    trackPosition: trackNumber,
                    
                    // Medium
                    mediumNumber: discNumber,
                    
                    // Duration
                    duration: (track.duration || 180) * 1000,
                    
                    // KRITISCH: Artist-Credit mit dem Haupt-Künstler-ID
                    // Dies verhindert den NullReferenceException in MapTrack!
                    artistCredit: [
                        {
                            id: artistId,
                            name: artistName
                        }
                    ]
                };
            });

            // Album für Lidarr
            albums.push({
                // Album-IDs
                Id: albumId,
                
                // Album-Info
                Title: title,
                Type: albumType,
                SecondaryTypes: secondaryTypes,
                ReleaseStatuses: ["Official"],
                
                // Releases
                releases: [{
                    // Release-IDs
                    Id: releaseId,
                    
                    // Release-Info
                    Title: title,
                    status: "Official",
                    country: ["Worldwide"],
                    label: [albumDetails.label || ""],
                    format: "Digital Media",
                    releaseDate: albumDetails.release_date || "",
                    
                    // Media und Tracks
                    media: media,
                    tracks: mappedTracks
                }]
            });
            
            console.log(`  ✓ Album geladen: ${title} (${tracks.length} Tracks)`);
            
        } catch (error) {
            console.error(`  Fehler bei Album ${albumSummary.id}:`, error);
        }
    }

    console.log(`Künstler vollständig: ${albums.length} Alben geladen`);

    // FINALES KÜNSTLER-OBJEKT mit allen Artists im Dictionary
    const artist = {
        // Basis-IDs
        id: artistId,
        foreignArtistId: artistId,
        
        // Namen
        artistName: artistName,
        sortName: artistName.split(" ").reverse().join(", "),
        
        // Disambiguation
        disambiguation: "",
        
        // Overview
        overview: `Künstler von Deezer importiert (ID: ${artistData.id})`,
        
        // Status
        status: "active",
        type: "Artist",
        
        // Bilder
        images: artistData.picture_xl ? [
            {
                coverType: "Poster",
                url: artistData.picture_xl
            }
        ] : [],
        
        // Links
        links: [],
        
        // Genres
        genres: [],
        
    
        
        // Alben
        Albums: albums,
        
        // Legacy
        oldForeignArtistIds: []
    };
    
    return artist;
}

// SUCHFUNKTION
export async function search(lidarrResults: any[], query: string): Promise<any[]> {
    if (!query || query.trim().length === 0) {
        return lidarrResults;
    }

    console.log(`Suche nach: "${query}"`);
    
    // Hole Deemix-Ergebnisse
    const deemixArtists = await searchDeemixArtists(query);
    
    // Filtere bereits vorhandene
    const existingNames = new Set(
        lidarrResults
            .filter(item => item?.artist?.artistName)
            .map(item => normalize(item.artist.artistName))
    );
    
    // Erstelle Deemix-Suchergebnisse
    const deemixResults = [];
    
    for (const artist of deemixArtists) {
        // Skip wenn bereits vorhanden
        if (existingNames.has(normalize(artist.name))) {
            continue;
        }
        
        const artistId = fakeId(artist.id, "artist");
        
        // Suchergebnis-Format
        deemixResults.push({
            artist: {
                // IDs
                id: artistId,
                foreignArtistId: artistId,
                
                // Namen
                artistName: artist.name,
                sortName: artist.name.split(" ").reverse().join(", "),
                
                // Disambiguation
                disambiguation: "",
                
                // Overview
                overview: `Von Deezer verfügbar`,
                
                // Status
                status: "active",
                type: "Artist",
                
                // Bilder
                images: artist.picture_xl ? [
                    {
                        coverType: "Poster",
                        url: artist.picture_xl
                    }
                ] : [],
                
                // Links
                links: [],
                
                // Genres
                genres: []
            }
        });
    }
    
    console.log(`Suchergebnisse: ${lidarrResults.length} MusicBrainz, ${deemixResults.length} Deemix`);
    
    // IMMER Deemix-Ergebnisse verwenden, auch wenn MusicBrainz verfügbar ist
    // Bei API-Ausfall nur Deemix
    if (lidarrResults.length === 0 && deemixResults.length > 0) {
        console.log("MusicBrainz/Lidarr API nicht verfügbar - verwende nur Deemix");
        return deemixResults;
    }
    
    // Kombiniere IMMER beide Quellen
    // Deemix-Ergebnisse werden immer hinzugefügt
    if (process.env.PRIO_DEEMIX === "true") {
        return [...deemixResults, ...lidarrResults];
    }
    
    // Standard: MusicBrainz zuerst, dann Deemix
    return [...lidarrResults, ...deemixResults];
}