import fetch from "node-fetch";
import _ from "lodash";
import { normalize, titleCase } from "./helpers.js";

const deemixUrl = process.env.DEEMIX_URL || "http://127.0.0.1:7272";

// Stabile Fetch-Funktion mit Retry
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

// Extrahiert die echte Deemix-ID aus unserer Fake-ID
export function getRealDeemixId(fakeId: string): string {
    if (!fakeId || typeof fakeId !== 'string') return '';
    const parts = fakeId.split('-');
    if (parts.length !== 5) return '';
    const idPart = parts[4];
    return idPart ? idPart.replace(/^[a-z]+/, '') : '';
}

// Suche nach Künstlern in Deemix
async function searchDeemixArtists(name: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/search/artists?limit=100&offset=0&q=${encodeURIComponent(name)}`);
    return data?.data || [];
}

// Hole Album-Tracks von Deemix
async function getDeemixTracks(albumId: string): Promise<any[]> {
    const data = await safeDeemixFetch(`/album/${albumId}/tracks`);
    return data?.data || [];
}

// Hole Album-Details von Deemix
async function getDeemixAlbum(albumId: string): Promise<any> {
    return await safeDeemixFetch(`/albums/${albumId}`);
}

// HAUPTFUNKTION: Erstellt ein vollständiges Künstler-Objekt für Lidarr
export async function getDeemixArtistById(deemixId: string): Promise<any> {
    if (!deemixId) {
        console.error("Keine Deemix-ID angegeben");
        return null;
    }

    console.log(`========================================`);
    console.log(`Lade Künstler von Deemix: ${deemixId}`);
    
    const artistData = await safeDeemixFetch(`/artists/${deemixId}`);
    
    if (!artistData) {
        console.error(`Künstler ${deemixId} nicht gefunden`);
        return null;
    }

    const artistId = fakeId(artistData.id, "artist");
    const artistName = artistData.name || "Unknown Artist";
    
    console.log(`Künstler: ${artistName}`);
    console.log(`Künstler-ID: ${artistId}`);
    
    // Verarbeite alle Alben des Künstlers
    const albumsData = artistData.albums?.data || [];
    const albums = [];
    
    console.log(`Verarbeite ${albumsData.length} Alben...`);
    
    for (const albumSummary of albumsData) {
        try {
            console.log(`  → Lade Album: ${albumSummary.title}`);
            
            const albumDetails = await getDeemixAlbum(albumSummary.id);
            if (!albumDetails) {
                console.warn(`    ✗ Album ${albumSummary.id} konnte nicht geladen werden`);
                continue;
            }

            const tracks = await getDeemixTracks(albumSummary.id);
            if (!tracks || tracks.length === 0) {
                console.warn(`    ✗ Album ${albumSummary.id} hat keine Tracks`);
                continue;
            }
            
            const albumId = fakeId(albumDetails.id, "album");
            const releaseId = fakeId(albumDetails.id, "release");
            const title = albumDetails.title || "Unknown Album";
            
            // Bestimme Album-Typ
            let albumType = "Album";
            const recordType = (albumDetails.record_type || "").toLowerCase();
            if (recordType === 'ep') albumType = "EP";
            else if (recordType === 'single') albumType = "Single";
            else if (recordType === 'compilation') albumType = "Compilation";
            
            // Bestimme Secondary Types
            const secondaryTypes = [];
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes("live")) secondaryTypes.push("Live");
            if (lowerTitle.includes("remix")) secondaryTypes.push("Remix");
            if (lowerTitle.includes("acoustic")) secondaryTypes.push("Acoustic");
            if (lowerTitle.includes("deluxe")) secondaryTypes.push("Deluxe");
            
            // Erstelle Media-Objekte für jede Disc
            const discNumbers = _.uniq(tracks.map(t => t.disk_number || 1)).sort();
            const media = discNumbers.map(discNum => ({
                Format: "Digital Media",
                Name: "",
                Position: discNum
            }));

            // KRITISCH: Track-Struktur MUSS EXAKT so sein!
            const mappedTracks = tracks.map((track: any, idx: number) => {
                const trackNumber = track.track_position || (idx + 1);
                const discNumber = track.disk_number || 1;
                
                return {
                    // Pflicht-Felder für Tracks
                    id: fakeId(track.id, "track"),
                    recordingId: fakeId(track.id, "recording"),
                    title: track.title || `Track ${trackNumber}`,
                    trackPosition: trackNumber,
                    mediumNumber: discNumber,
                    duration: (track.duration || 180) * 1000,
                    
                    // KRITISCH: artistCredit MUSS ein LEERES Array sein!
                    // Nicht null, nicht undefined, nicht gefüllt - LEER!
                    artistCredit: []
                };
            });

            // Erstelle Album-Objekt
            albums.push({
                // Album Basis-Info
                Id: albumId,
                Title: title,
                Type: albumType,
                SecondaryTypes: secondaryTypes,
                ReleaseStatuses: ["Official"],
                
                // Releases mit Tracks
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
            });
            
            console.log(`    ✓ Album geladen: ${title} (${albumType}, ${tracks.length} Tracks)`);
            
        } catch (error) {
            console.error(`    ✗ Fehler bei Album ${albumSummary.id}:`, error);
        }
    }

    console.log(`----------------------------------------`);
    console.log(`✓ ${albums.length} Alben erfolgreich verarbeitet`);
    console.log(`========================================`);

    // Erstelle das finale Künstler-Objekt für Lidarr
    const finalArtist = {
        // Künstler-IDs
        id: artistId,
        foreignArtistId: artistId,
        
        // Künstler-Namen
        artistName: artistName,
        sortName: artistName.split(" ").reverse().join(", "),
        
        // Metadaten
        disambiguation: "",
        overview: `Künstler von Deezer/Deemix importiert (Original-ID: ${artistData.id})`,
        
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
        
        // Links (leer aber vorhanden)
        links: [],
        
        // Genres (leer aber vorhanden)
        genres: [],
        
        // Die Alben
        Albums: albums,
        
        // Legacy (leer aber vorhanden)
        oldForeignArtistIds: []
    };
    
    return finalArtist;
}

// SUCHFUNKTION: Kombiniert MusicBrainz und Deemix Ergebnisse
export async function search(lidarrResults: any[], query: string): Promise<any[]> {
    if (!query || query.trim().length === 0) {
        return lidarrResults || [];
    }

    console.log(`Suche nach: "${query}"`);
    
    // Hole Deemix-Ergebnisse
    let deemixArtists = [];
    try {
        deemixArtists = await searchDeemixArtists(query);
        console.log(`  → ${deemixArtists.length} Künstler von Deemix gefunden`);
    } catch (e) {
        console.error('Fehler bei Deemix-Suche:', e);
    }
    
    // Erstelle Set mit bereits vorhandenen Künstlern (case-insensitive)
    const existingNames = new Set(
        (lidarrResults || [])
            .filter(item => item?.artist?.artistName)
            .map(item => normalize(item.artist.artistName))
    );
    
    // Erstelle Deemix-Suchergebnisse
    const deemixResults = [];
    
    for (const artist of deemixArtists) {
        // Skip wenn Künstler bereits in MusicBrainz-Ergebnissen
        if (existingNames.has(normalize(artist.name))) {
            continue;
        }
        
        const artistId = fakeId(artist.id, "artist");
        
        // Suchergebnis-Objekt für UI
        deemixResults.push({
            artist: {
                id: artistId,
                foreignArtistId: artistId,
                artistName: artist.name,
                sortName: artist.name.split(" ").reverse().join(", "),
                disambiguation: "",
                overview: `Von Deezer verfügbar (${artist.nb_fan || 0} Fans)`,
                status: "active",
                type: "Artist",
                images: artist.picture_xl ? [
                    {
                        coverType: "Poster",
                        url: artist.picture_xl
                    }
                ] : [],
                links: [],
                genres: []
            }
        });
    }
    
    console.log(`  → ${lidarrResults?.length || 0} MusicBrainz + ${deemixResults.length} neue Deemix = ${(lidarrResults?.length || 0) + deemixResults.length} gesamt`);
    
    // IMMER Deemix-Ergebnisse anzeigen!
    // Bei MusicBrainz-Ausfall nur Deemix
    if (!lidarrResults || lidarrResults.length === 0) {
        console.log("MusicBrainz nicht verfügbar - verwende nur Deemix");
        return deemixResults;
    }
    
    // Kombiniere beide Quellen
    if (process.env.PRIO_DEEMIX === "true") {
        // Deemix zuerst
        return [...deemixResults, ...lidarrResults];
    }
    
    // Standard: MusicBrainz zuerst, dann Deemix
    return [...lidarrResults, ...deemixResults];
}