import fetch from "node-fetch";
import Fastify from "fastify";
import dotenv from "dotenv";
import { search, getDeemixArtistById, getRealDeemixId } from "./deemix.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = process.env.LIDARR_API_URL || "https://api.lidarr.audio";
const fastify = Fastify({ 
    logger: {
        level: process.env.LOG_LEVEL || 'info'
    },
    bodyLimit: 10485760, // 10MB
    trustProxy: true
});

// Globaler Error Handler
fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error({
        err: error,
        request: {
            method: request.method,
            url: request.url,
            params: request.params,
            query: request.query
        }
    }, 'Request failed');
    
    // WICHTIG: Immer eine gültige JSON-Antwort senden!
    if (!reply.sent) {
        // Bei Suchfehlern leeres Array, sonst leeres Objekt
        if (request.url.includes('/search')) {
            reply.status(200).send([]);
        } else {
            reply.status(404).send({});
        }
    }
});

// Health Check
fastify.get('/health', async (req, reply) => {
    reply.status(200).send({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

async function doApi(req: any, res: any) {
    const startTime = Date.now();
    const u = new URL(`http://localhost${req.url}`);
    const url = `${u.pathname}${u.search}`;
    const method = req.method;
    
    fastify.log.info({ method, url }, 'Processing request');
    
    // Headers aufbereiten
    const headers: { [key: string]: any } = {};
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
            headers[key] = value;
        }
    });
    
    let status = 200;
    let finalResult: any = null;

    try {
        // ARTIST DETAILS
        if (url.includes("/v0.4/artist/") && !url.includes("/v0.4/artist/lookup")) {
            const pathParts = u.pathname.split('/');
            const artistId = pathParts[pathParts.length - 1];
            
            if (!artistId || artistId === '') {
                fastify.log.warn('Keine Künstler-ID in der URL');
                return res.status(404).send({});
            }
            
            // Deemix-Künstler
            if (artistId.startsWith('aaaaaaaa-aaaa-aaaa-aaaa-')) {
                fastify.log.info(`Lade Deemix-Künstler: ${artistId}`);
                const realDeemixId = getRealDeemixId(artistId);
                
                if (!realDeemixId) {
                    fastify.log.error(`Ungültige Deemix-ID: ${artistId}`);
                    return res.status(404).send({});
                }
                
                finalResult = await getDeemixArtistById(realDeemixId);
                if (!finalResult) {
                    return res.status(404).send({});
                }
                
                return res.status(200).send(finalResult);
            }
            
            // MusicBrainz-Künstler
            fastify.log.info(`Lade MusicBrainz-Künstler: ${artistId}`);
            const mbidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            
            if (!mbidRegex.test(artistId)) {
                fastify.log.warn(`Ungültiges MBID-Format: ${artistId}`);
                return res.status(404).send({});
            }
            
            finalResult = await getArtistData(artistId);
            if (!finalResult) {
                return res.status(404).send({});
            }
            
            return res.status(200).send(finalResult);
        }
        
        // SEARCH
        else if (url.includes("/v0.4/search")) {
            const queryParam = u.searchParams.get("query") || "";
            
            if (!queryParam) {
                fastify.log.info('Leere Suchanfrage');
                return res.status(200).send([]);
            }
            
            // Versuche Lidarr API
            let lidarrResults: any[] = [];
            try {
                const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { 
                    method, 
                    headers,
                    timeout: 5000 // Reduziertes Timeout
                });
                
                if (upstreamResponse.ok) {
                    const parsed = await upstreamResponse.json();
                    lidarrResults = Array.isArray(parsed) ? parsed : [];
                    fastify.log.info(`Lidarr API lieferte ${lidarrResults.length} Ergebnisse`);
                } else {
                    fastify.log.warn(`Lidarr API antwortete mit Status ${upstreamResponse.status}`);
                }
            } catch (e) {
                fastify.log.warn('Lidarr API nicht erreichbar, nutze nur Deemix');
            }
            
            // Kombiniere mit Deemix
            finalResult = await search(lidarrResults, queryParam);
            
            // WICHTIG: Immer ein Array zurückgeben, auch wenn leer
            if (!Array.isArray(finalResult)) {
                finalResult = [];
            }
            
            return res.status(200).send(finalResult);
        }
        
        // ALLE ANDEREN ANFRAGEN
        else {
            fastify.log.info('Leite Anfrage weiter');
            
            try {
                const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { 
                    method, 
                    headers,
                    body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
                    timeout: 10000
                });
                
                if (upstreamResponse.ok) {
                    const contentType = upstreamResponse.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        finalResult = await upstreamResponse.json();
                    } else {
                        finalResult = await upstreamResponse.text();
                    }
                    status = upstreamResponse.status;
                } else {
                    // Bei Fehler trotzdem 200 mit leerem Ergebnis
                    fastify.log.warn(`Upstream error: ${upstreamResponse.status}`);
                    finalResult = url.includes('search') ? [] : {};
                    status = 200;
                }
            } catch (e: any) {
                fastify.log.error(e, 'Upstream-Anfrage fehlgeschlagen');
                // Bei Fehler trotzdem 200 mit leerem Ergebnis
                finalResult = url.includes('search') ? [] : {};
                status = 200;
            }
            
            return res.status(status).send(finalResult);
        }
        
    } catch (error: any) {
        fastify.log.error(error, 'Unerwarteter Fehler');
        // WICHTIG: Niemals 5xx Fehler zurückgeben, sonst bricht Lidarr ab
        if (url.includes('search')) {
            return res.status(200).send([]);
        } else {
            return res.status(404).send({});
        }
    }
}

// Hauptroute
fastify.all('*', async (req: any, res: any) => {
    try {
        await doApi(req, res);
    } catch (err: any) {
        fastify.log.error(err, 'Kritischer Fehler');
        // Sende immer eine gültige Antwort
        if (!res.sent) {
            if (req.url.includes('search')) {
                res.status(200).send([]);
            } else {
                res.status(404).send({});
            }
        }
    }
});

// Server starten
const start = async () => {
    try {
        const port = parseInt(process.env.PROXY_PORT || '7171');
        const host = process.env.PROXY_HOST || '0.0.0.0';
        
        await fastify.listen({ port, host });
        
        console.log(`
╔════════════════════════════════════════════════════╗
║     Lidarr++Deemix Proxy erfolgreich gestartet    ║
╠════════════════════════════════════════════════════╣
║  Proxy läuft auf: http://${host}:${port}           
║  Deemix URL: ${process.env.DEEMIX_URL || 'http://127.0.0.1:7272'}
║  Lidarr API: ${lidarrApiUrl}
║  Modus: Deemix${process.env.OVERRIDE_MB === 'true' ? ' ONLY' : ' + MusicBrainz'}
╚════════════════════════════════════════════════════╝
        `);
    } catch (err) {
        fastify.log.error(err, 'Server konnte nicht gestartet werden');
        process.exit(1);
    }
};

// Graceful Shutdown
process.on('SIGTERM', async () => {
    fastify.log.info('SIGTERM empfangen');
    await fastify.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    fastify.log.info('SIGINT empfangen');
    await fastify.close();
    process.exit(0);
});

start();