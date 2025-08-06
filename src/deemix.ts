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

// Konsistente Fake-ID-Generierung für Lidarr
function fakeId(id: any, type: string): string {
    const prefixes: { [key: string]: string } = {
        artist: "a",
        album: "b", 
        track: "c",
        release: "d",
        recording: "e",
        label: "f",
        work: "g"
    };
    
    const prefix = prefixes[type] || "z";
    const paddedId = String(id).padStart(12, prefix);
    
    // Konsistentes UUID-Format für Lidarr
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
async function searchDeemixArtists(name: string): Promise<any[]> {
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

// Erstelle ein Artist-Dictionary für Lidarr
function createArtistDict(artistId: string, artistName: string): any {
    const dict: any = {};
    dict[artistId] = {
        id: artistId,
        artistid: artistId,
        foreignArtistId: artistId,
        artistname: artistName,
        sortname: artistName.split(" ").reverse().join(", "),
        disambiguation: "",
        status: "active",
        type: "Artist"
    };
    return dict;
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

    // Generiere konsistente IDs
    const artistId = fakeId(artistData.id, "artist");
    const artistName = artistData.name || "Unknown Artist";
    
    // Erstelle Artist-Dictionary für Track-Mapping
    const artistDict = createArtistDict(artistId, artistName);
    
    // Basis-Künstler-Objekt
    const baseArtist = {
        id: artistId,
        artistid: artistId,
        foreignArtistId: artistId,
        artistname: artistName,
        sortname: artistName.split(" ").reverse().join(", "),
        disambiguation: `Deemix ID: ${artistData.id}`,
        overview: `Künstler von Deezer/Deemix importiert. Original-ID: ${artistData.id}`,
        status: "active",
        type: "Artist"
    };

    // Lade alle Alben parallel
    const albumPromises = (artistData.albums?.data || []).map(async (albumSummary: any) => {
        try {
            console.log(`Lade Album ${albumSummary.id}: ${albumSummary.title}`);
            const albumDetails = await getDeemixAlbum(albumSummary.id);
            
            if (!albumDetails) {
                console.warn(`Album ${albumSummary.id} konnte nicht geladen werden`);
                return null;
            }

            const tracks = await getDeemixTracks(albumSummary.id);
            
            // Validierung der Tracks
            if (!tracks || tracks.length === 0) {
                console.warn(`Album ${albumSummary.id} hat keine Tracks, überspringe...`);
                return null;
            }
            
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

            // Secondary Types
            const secondaryTypes: string[] = [];
            const lowerTitle = title.toLowerCase();
            if (lowerTitle.includes("live")) secondaryTypes.push("Live");
            if (lowerTitle.includes("remix")) secondaryTypes.push("Remix");
            if (lowerTitle.includes("deluxe")) secondaryTypes.push("Deluxe");
            
            // Gruppiere Tracks nach Disc
            const tracksByDisc = _.groupBy(tracks, t => t.disk_number || 1);
            const media = Object.keys(tracksByDisc).map(discNum => ({
                Format: "Digital Media",
                Name: `CD${discNum}`,
                Position: parseInt(discNum),
                track_count: tracksByDisc[discNum].length
            }));

            // Mappe alle Tracks mit vollständigen Informationen
            const mappedTracks = tracks.map((track: any, globalIdx: number) => {
                const trackNumber = track.track_position || (globalIdx + 1);
                const discNumber = track.disk_number || 1;
                const trackId = fakeId(track.id, "track");
                const recordingId = fakeId(track.id, "recording");
                
                // WICHTIG: Vollständiges Track-Objekt für Lidarr
                return {
                    // Pflicht-IDs
                    id: trackId,
                    Id: trackId,
                    trackid: trackId,
                    recordingid: recordingId,
                    recordingId: recordingId,
                    
                    // Künstler-Zuordnung (KRITISCH!)
                    artistid: artistId,
                    artistId: artistId,
                    artists: artistDict,  // Als Dictionary, nicht Array!
                    artistCredit: artistName,
                    
                    // Track-Informationen
                    title: track.title || track.title_short || `Track ${trackNumber}`,
                    trackname: track.title || track.title_short || `Track ${trackNumber}`,
                    trackName: track.title || track.title_short || `Track ${trackNumber}`,
                    
                    // Position
                    tracknumber: String(trackNumber),
                    trackNumber: String(trackNumber),
                    trackposition: trackNumber,
                    trackPosition: trackNumber,
                    absoluteTrackNumber: globalIdx + 1,
                    
                    // Medium/Disc
                    mediumnumber: discNumber,
                    mediumNumber: discNumber,
                    mediumname: `CD${discNumber}`,
                    mediumName: `CD${discNumber}`,
                    
                    // Duration (beide Formate)
                    duration: (track.duration || 180) * 1000,
                    durationms: (track.duration || 180) * 1000,
                    
                    // Zusätzliche Metadaten
                    explicit: track.explicit_lyrics || false,
                    hasFile: false,
                    trackFileId: 0,
                    ratings: { votes: 0, value: 0 },
                    
                    // Legacy Arrays (leer aber vorhanden)
                    oldids: [],
                    oldIds: [],
                    oldrecordingids: [],
                    oldRecordingIds: []
                };
            });

            // Album-Objekt für Lidarr
            return {
                // IDs
                Id: albumId,
                id: albumId,
                albumid: albumId,
                albumId: albumId,
                foreignAlbumId: albumId,
                
                // Titel
                Title: title,
                title: title,
                LowerTitle: normalize(title),
                lowerTitle: normalize(title),
                cleanTitle: normalize(title),
                
                // Album-Typ und Status
                Type: albumType,
                type: albumType,
                ReleaseStatuses: ["Official"],
                releaseStatuses: ["Official"],
                SecondaryTypes: secondaryTypes,
                secondaryTypes: secondaryTypes,
                
                // Künstler-Zuordnung (WICHTIG!)
                artistid: artistId,
                artistId: artistId,
                artists: artistDict,  // Als Dictionary!
                artist: baseArtist,
                artistCredit: artistName,
                
                // Metadaten
                releaseDate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                disambiguation: "",
                duration: tracks.reduce((sum: number, t: any) => sum + ((t.duration || 180) * 1000), 0),
                
                // Bilder
                images: albumDetails.cover_xl ? [{
                    coverType: "Cover",
                    url: albumDetails.cover_xl
                }] : [],
                
                // Release mit Tracks
                releases: [{
                    // Release IDs
                    Id: releaseId,
                    id: releaseId,
                    releaseid: releaseId,
                    releaseId: releaseId,
                    
                    // Release-Info
                    Title: title,
                    title: title,
                    disambiguation: "",
                    
                    // Status
                    status: "Official",
                    country: ["Worldwide"],
                    
                    // Label
                    label: [albumDetails.label || "Unknown Label"],
                    labelid: albumDetails.label ? [fakeId(albumDetails.label, "label")] : [],
                    
                    // Format
                    format: "Digital Media",
                    
                    // Datum
                    releasedate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                    releaseDate: albumDetails.release_date || new Date().toISOString().split('T')[0],
                    
                    // Anzahl
                    track_count: tracks.length,
                    trackCount: tracks.length,
                    
                    // Media-Information
                    media: media,
                    
                    // Tracks (WICHTIG: Mit vollständigen Infos!)
                    tracks: mappedTracks,
                    
                    // Legacy
                    oldids: [],
                    oldIds: []
                }],
                
                // Zusätzliche Felder
                monitored: false,
                anyReleaseOk: true,
                profileId: 1,
                ratings: { votes: 0, value: 0 },
                statistics: {
                    trackCount: tracks.length,
                    totalTrackCount: tracks.length,
                    sizeOnDisk: 0,
                    percentOfTracks: 0
                }
            };
        } catch (error) {
            console.error(`Fehler beim Verarbeiten von Album ${albumSummary.id}:`, error);
            return null;
        }
    });

    const albums = (await Promise.all(albumPromises)).filter(Boolean);
    console.log(`${albums.length} Alben erfolgreich geladen`);

    // Vollständiges Künstler-Objekt
    const finalArtist = {
        // Basis-IDs
        ...baseArtist,
        
        // Aliases und Links
        artistaliases: [],
        artistAliases: [],
        links: artistData.link ? [{ name: "Deezer", url: artistData.link }] : [],
        
        // Bilder
        images: artistData.picture_xl ? [
            { coverType: "Poster", url: artistData.picture_xl },
            { coverType: "Fanart", url: artistData.picture_xl },
            { coverType: "Banner", url: artistData.picture_medium || artistData.picture_xl }
        ] : [],
        
        // Alben (mit capital A!)
        Albums: albums,
        albums: albums,
        
        // Genres
        genres: [],
        tags: [],
        
        // IDs von anderen Diensten
        tadbId: 0,
        discogsId: 0,
        allMusicId: null,
        
        // Legacy IDs
        OldForeignArtistIds: [],
        oldForeignArtistIds: [],
        oldids: [],
        oldIds: [],
        
        // Statistiken
        ratings: { votes: 0, value: 0 },
        statistics: {
            albumCount: albums.length,
            trackCount: albums.reduce((sum, album) => 
                sum + (album.releases?.[0]?.tracks?.length || 0), 0),
            sizeOnDisk: 0,
            percentOfTracks: 0
        },
        
        // Monitoring-Einstellungen
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitored: false,
        monitorNewItems: "all",
        rootFolderPath: null,
        
        // Zeitstempel
        added: new Date().toISOString(),
        lastInfoSync: new Date().toISOString(),
        
        // Zusätzliche Felder
        cleanName: normalize(artistName),
        path: null,
        folder: null
    };
    
    console.log(`Künstler ${artistName} erstellt mit ${albums.length} Alben und ${finalArtist.statistics.trackCount} Tracks`);
    
    return finalArtist;
}

// Suche und kombiniere Ergebnisse
export async function search(lidarrResults: any[], query: string): Promise<any[]> {
    if (!query || query.trim().length === 0) {
        return lidarrResults;
    }

    console.log(`Suche nach: "${query}"`);
    
    const deemixArtists = await searchDeemixArtists(query);
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
                // IDs
                id: artistId,
                artistid: artistId,
                artistId: artistId,
                foreignArtistId: artistId,
                
                // Name
                artistname: artist.name,
                artistName: artist.name,
                sortname: artist.name.split(" ").reverse().join(", "),
                sortName: artist.name.split(" ").reverse().join(", "),
                
                // Bilder
                images: artist.picture_xl ? [
                    { coverType: "Poster", url: artist.picture_xl }
                ] : [],
                
                // Metadaten
                disambiguation: `Deemix ID: ${artist.id}`,
                overview: `Von Deezer verfügbar`,
                
                // Aliases und Genres
                artistaliases: [],
                artistAliases: [],
                genres: [],
                tags: [],
                
                // Status
                status: "active",
                type: "Artist",
                
                // Ratings und Stats
                ratings: { votes: 0, value: 0 },
                statistics: { 
                    albumCount: artist.nb_album || 0, 
                    trackCount: 0,
                    sizeOnDisk: 0,
                    percentOfTracks: 0
                }
            }
        });
    }
    
    console.log(`Gefunden: ${lidarrResults.length} Lidarr, ${deemixResults.length} Deemix`);
    
    // Kombiniere Ergebnisse
    if (process.env.PRIO_DEEMIX === "true") {
        return [...deemixResults, ...lidarrResults];
    }
    
    return [...lidarrResults, ...deemixResults];
}