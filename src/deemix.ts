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
        recording: "e",
        work: "f",
        label: "g"
    };
    
    const prefix = prefixes[type] || "z";
    const paddedId = String(id).padStart(12, prefix);
    
    // MusicBrainz UUID Format
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

// HAUPTFUNKTION: Baut vollständiges Künstler-Objekt für Lidarr
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
            console.log(`Lade Album ${albumSummary.id}: ${albumSummary.title}`);
            const albumDetails = await getDeemixAlbum(albumSummary.id);
            if (!albumDetails) {
                console.warn(`Album ${albumSummary.id} konnte nicht geladen werden`);
                return null;
            }

            const tracks = await getDeemixTracks(albumSummary.id);
            if (!tracks || tracks.length === 0) {
                console.warn(`Album ${albumSummary.id} hat keine Tracks`);
                return null;
            }
            
            const albumId = fakeId(albumDetails.id, "album");
            const releaseId = fakeId(albumDetails.id, "release");
            const title = titleCase(albumDetails.title || "Unknown Album");
            
            // Album-Typ bestimmen
            let albumType = "Album";
            const recordType = (albumDetails.record_type || "album").toLowerCase();
            if (recordType === 'ep') albumType = "EP";
            else if (recordType === 'single') albumType = "Single";
            else if (recordType === 'compilation') albumType = "Compilation";
            else albumType = titleCase(recordType);
            
            // Secondary Types (IMMER als Array, nie null!)
            const secondaryTypes = [];
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes("live")) secondaryTypes.push("Live");
            if (lowerTitle.includes("remix")) secondaryTypes.push("Remix");
            if (lowerTitle.includes("acoustic")) secondaryTypes.push("Acoustic");
            if (lowerTitle.includes("deluxe")) secondaryTypes.push("Deluxe");
            
            // Media für jede Disc
            const discNumbers = _.uniq(tracks.map(t => t.disk_number || 1)).sort();
            const media = discNumbers.map(discNum => {
                const discTracks = tracks.filter(t => (t.disk_number || 1) === discNum);
                return {
                    Format: "Digital Media",
                    Name: "",
                    Position: discNum,
                    track_count: discTracks.length
                };
            });

            // Track-Mapping mit vollständigen Informationen
            const mappedTracks = tracks.map((track: any, idx: number) => {
                const trackId = fakeId(track.id, "track");
                const recordingId = fakeId(track.id, "recording");
                const trackNumber = track.track_position || (idx + 1);
                const discNumber = track.disk_number || 1;
                
                return {
                    // IDs
                    id: trackId,
                    trackid: trackId,
                    recordingid: recordingId,
                    recordingId: recordingId,
                    
                    // Track-Info
                    title: track.title || track.title_short || `Track ${trackNumber}`,
                    trackname: track.title || track.title_short || `Track ${trackNumber}`,
                    
                    // Position
                    trackNumber: String(trackNumber),
                    tracknumber: String(trackNumber),
                    trackPosition: trackNumber,
                    trackposition: trackNumber,
                    
                    // Medium
                    mediumNumber: discNumber,
                    mediumnumber: discNumber,
                    
                    // Duration
                    duration: (track.duration || 180) * 1000,
                    durationms: (track.duration || 180) * 1000,
                    
                    // Zusätzliche Felder
                    explicit: track.explicit_lyrics || false,
                    
                    // Legacy (IMMER als leere Arrays!)
                    oldIds: [],
                    oldRecordingIds: []
                };
            });

            // Album-Objekt (VOLLSTÄNDIG für Lidarr)
            return {
                // Haupt-IDs
                Id: albumId,
                id: albumId,
                foreignAlbumId: albumId,
                
                // Titel
                Title: title,
                title: title,
                cleanTitle: normalize(title),
                
                // Album-Typ und Status
                Type: albumType,
                type: albumType,
                ReleaseStatuses: ["Official"], // IMMER als Array!
                releaseStatuses: ["Official"],
                SecondaryTypes: secondaryTypes, // IMMER als Array, auch wenn leer!
                secondaryTypes: secondaryTypes,
                
                // Datum
                releaseDate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                
                // Disambiguation
                disambiguation: "",
                
                // Duration
                duration: tracks.reduce((sum: number, t: any) => sum + ((t.duration || 180) * 1000), 0),
                
                // Bilder (IMMER als Array!)
                images: albumDetails.cover_xl ? [{
                    coverType: "Cover",
                    url: albumDetails.cover_xl,
                    extension: ".jpg"
                }] : [],
                
                // Links (IMMER als Array!)
                links: [],
                
                // Genres (IMMER als Array!)
                genres: [],
                
                // Ratings
                ratings: {
                    votes: 0,
                    value: 0
                },
                
                // Releases (IMMER als Array mit mindestens einem Release!)
                releases: [{
                    // Release IDs
                    Id: releaseId,
                    id: releaseId,
                    foreignReleaseId: releaseId,
                    
                    // Release-Info
                    Title: title,
                    title: title,
                    disambiguation: "",
                    
                    // Status
                    status: "Official",
                    
                    // Country (IMMER als Array!)
                    country: ["Worldwide"],
                    
                    // Label (IMMER als Array!)
                    label: albumDetails.label ? [albumDetails.label] : ["Unknown Label"],
                    
                    // Format
                    format: "Digital Media",
                    
                    // Datum
                    releaseDate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                    releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                    
                    // Track-Anzahl
                    track_count: tracks.length,
                    trackCount: tracks.length,
                    
                    // Media (IMMER als Array!)
                    media: media,
                    
                    // Tracks (IMMER als Array!)
                    tracks: mappedTracks,
                    
                    // Legacy (IMMER als Array!)
                    oldIds: []
                }],
                
                // Legacy (IMMER als Arrays!)
                oldIds: []
            };
        } catch (error) {
            console.error(`Fehler bei Album ${albumSummary.id}:`, error);
            return null;
        }
    });

    const albums = (await Promise.all(albumPromises)).filter(Boolean);
    console.log(`${albums.length} Alben erfolgreich geladen`);

    // FINALES KÜNSTLER-OBJEKT (VOLLSTÄNDIG für Lidarr)
    const finalArtist = {
        // Haupt-IDs
        id: artistId,
        foreignArtistId: artistId,
        
        // Namen
        artistName: artistName,
        sortName: artistName.split(" ").reverse().join(", "),
        cleanName: normalize(artistName),
        
        // Disambiguation und Overview
        disambiguation: `Deemix ID: ${artistData.id}`,
        overview: `Künstler importiert von Deezer/Deemix. Original-ID: ${artistData.id}`,
        
        // Status
        status: "active",
        type: "Artist",
        
        // Bilder (IMMER als Array!)
        images: artistData.picture_xl ? [
            {
                coverType: "Poster",
                url: artistData.picture_xl,
                extension: ".jpg"
            },
            {
                coverType: "Fanart",
                url: artistData.picture_xl,
                extension: ".jpg"
            }
        ] : [],
        
        // Links (IMMER als Array!)
        links: artistData.link ? [{
            name: "Deezer",
            url: artistData.link
        }] : [],
        
        // Genres und Tags (IMMER als Arrays!)
        genres: [],
        tags: [],
        
        // Aliases (IMMER als Array!)
        artistAliases: [],
        
        // Alben (IMMER als Array!)
        Albums: albums,
        
        // IDs von anderen Diensten
        tadbId: 0,
        discogsId: 0,
        allMusicId: null,
        
        // Legacy (IMMER als Array!)
        oldForeignArtistIds: [],
        
        // Ratings
        ratings: {
            votes: 0,
            value: 0
        },
        
        // Statistiken
        statistics: {
            albumCount: albums.length,
            trackCount: albums.reduce((sum, album) => 
                sum + (album.releases?.[0]?.tracks?.length || 0), 0),
            sizeOnDisk: 0,
            percentOfTracks: 0
        },
        
        // Monitoring
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitored: false,
        monitorNewItems: "all",
        rootFolderPath: null,
        folder: null,
        path: null,
        
        // Zeitstempel
        added: new Date().toISOString(),
        lastInfoSync: new Date().toISOString()
    };
    
    console.log(`Künstler ${artistName} vollständig erstellt mit ${albums.length} Alben und ${finalArtist.statistics.trackCount} Tracks`);
    
    return finalArtist;
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
        // Skip wenn bereits in Lidarr-Ergebnissen
        if (existingNames.has(normalize(artist.name))) {
            continue;
        }
        
        const artistId = fakeId(artist.id, "artist");
        
        deemixResults.push({
            artist: {
                // IDs
                id: artistId,
                foreignArtistId: artistId,
                
                // Namen
                artistName: artist.name,
                sortName: artist.name.split(" ").reverse().join(", "),
                cleanName: normalize(artist.name),
                
                // Disambiguation
                disambiguation: `Deemix ID: ${artist.id}`,
                overview: `Von Deezer verfügbar`,
                
                // Status
                status: "active",
                type: "Artist",
                
                // Bilder (IMMER als Array!)
                images: artist.picture_xl ? [{
                    coverType: "Poster",
                    url: artist.picture_xl,
                    extension: ".jpg"
                }] : [],
                
                // Arrays (ALLE IMMER initialisiert!)
                links: [],
                genres: [],
                tags: [],
                artistAliases: [],
                
                // IDs
                tadbId: 0,
                discogsId: 0,
                allMusicId: null,
                
                // Legacy
                oldForeignArtistIds: [],
                
                // Ratings
                ratings: {
                    votes: 0,
                    value: 0
                },
                
                // Statistiken
                statistics: {
                    albumCount: artist.nb_album || 0,
                    trackCount: 0,
                    sizeOnDisk: 0,
                    percentOfTracks: 0
                }
            }
        });
    }
    
    console.log(`Suchergebnisse: ${lidarrResults.length} von Lidarr, ${deemixResults.length} von Deemix`);
    
    // Kombiniere Ergebnisse basierend auf Priorität
    if (process.env.PRIO_DEEMIX === "true") {
        return [...deemixResults, ...lidarrResults];
    }
    
    return [...lidarrResults, ...deemixResults];
}