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
    
    if (!reply.sent) {
        reply.status(500).send({ 
            error: "Internal Server Error", 
            message: process.env.NODE_ENV === 'development' ? error.message : 'Ein Fehler ist aufgetreten'
        });
    }
});

// Health Check Endpoint
fastify.get('/health', async (req, reply) => {
    const deemixHealthy = await checkDeemixHealth();
    const lidarrHealthy = await checkLidarrHealth();
    
    const status = deemixHealthy && lidarrHealthy ? 200 : 503;
    
    reply.status(status).send({
        status: status === 200 ? 'healthy' : 'degraded',
        services: {
            deemix: deemixHealthy ? 'up' : 'down',
            lidarr: lidarrHealthy ? 'up' : 'down'
        },
        timestamp: new Date().toISOString()
    });
});

async function checkDeemixHealth(): Promise<boolean> {
    try {
        const res = await fetch(`${process.env.DEEMIX_URL || 'http://127.0.0.1:7272'}/health`, {
            timeout: 3000
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function checkLidarrHealth(): Promise<boolean> {
    try {
        const res = await fetch(`${lidarrApiUrl}/api/v0.4/search?query=test`, {
            timeout: 3000
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function doApi(req: any, res: any) {
    const startTime = Date.now();
    const u = new URL(`http://localhost${req.url}`);
    const url = `${u.pathname}${u.search}`;
    const method = req.method;
    
    fastify.log.info({ method, url }, 'Processing request');
    
    // Headers aufbereiten (ohne host und connection)
    const headers: { [key: string]: any } = {};
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
            headers[key] = value;
        }
    });
    
    let status = 200;
    let finalResult: any = null;

    try {
        // Künstler-Details abrufen
        if (url.includes("/v0.4/artist/") && !url.includes("/v0.4/artist/lookup")) {
            const pathParts = u.pathname.split('/');
            const artistId = pathParts[pathParts.length - 1];
            
            if (!artistId || artistId === '') {
                fastify.log.warn('Keine Künstler-ID in der URL gefunden');
                status = 400;
                finalResult = { error: 'Künstler-ID fehlt' };
            } else if (artistId.startsWith('aaaaaaaa-aaaa-aaaa-aaaa-')) {
                // Deemix-Künstler
                fastify.log.info(`Lade Deemix-Künstler: ${artistId}`);
                const realDeemixId = getRealDeemixId(artistId);
                
                if (!realDeemixId) {
                    fastify.log.error(`Ungültige Deemix-ID: ${artistId}`);
                    status = 404;
                    finalResult = { error: 'Ungültige Künstler-ID' };
                } else {
                    finalResult = await getDeemixArtistById(realDeemixId);
                    if (!finalResult) {
                        status = 404;
                        finalResult = { error: 'Künstler nicht gefunden' };
                    }
                }
            } else {
                // MusicBrainz-Künstler
                fastify.log.info(`Lade MusicBrainz-Künstler: ${artistId}`);
                
                // Überprüfe MBID-Format
                const mbidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!mbidRegex.test(artistId)) {
                    fastify.log.warn(`Ungültiges MBID-Format: ${artistId}`);
                    status = 400;
                    finalResult = { error: 'Ungültiges MBID-Format' };
                } else {
                    finalResult = await getArtistData(artistId);
                    if (!finalResult) {
                        status = 404;
                        finalResult = { error: 'Künstler nicht in MusicBrainz gefunden' };
                    }
                }
            }
        }
        // Suche
        else if (url.includes("/v0.4/search")) {
            const queryParam = u.searchParams.get("query") || "";
            
            if (!queryParam) {
                fastify.log.info('Leere Suchanfrage');
                finalResult = [];
            } else {
                // Hole Lidarr-Ergebnisse
                let lidarrResults: any[] = [];
                try {
                    const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { 
                        method, 
                        headers,
                        timeout: 8000 
                    });
                    
                    if (upstreamResponse.ok) {
                        const parsed = await upstreamResponse.json();
                        lidarrResults = Array.isArray(parsed) ? parsed : [];
                        fastify.log.info(`Lidarr lieferte ${lidarrResults.length} Ergebnisse`);
                    }
                } catch (e) {
                    fastify.log.warn('Lidarr API nicht erreichbar, nutze nur Deemix');
                }
                
                // Kombiniere mit Deemix-Ergebnissen
                finalResult = await search(lidarrResults, queryParam);
            }
            
            if (Array.isArray(finalResult) && finalResult.length === 0) {
                status = 404;
            }
        }
        // Alle anderen Anfragen direkt an Lidarr weiterleiten
        else {
            fastify.log.info('Leite Anfrage an Lidarr weiter');
            try {
                const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { 
                    method, 
                    headers,
                    body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
                    timeout: 15000 
                });
                
                status = upstreamResponse.status;
                
                if (upstreamResponse.ok) {
                    const contentType = upstreamResponse.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        finalResult = await upstreamResponse.json();
                    } else {
                        finalResult = await upstreamResponse.text();
                    }
                } else {
                    finalResult = { error: `Upstream error: ${upstreamResponse.statusText}` };
                }
            } catch (e: any) {
                fastify.log.error(e, 'Fehler bei Upstream-Anfrage');
                status = 502;
                finalResult = { error: 'Bad Gateway' };
            }
        }
    } catch (error: any) {
        fastify.log.error(error, 'Unerwarteter Fehler');
        status = 500;
        finalResult = { error: 'Internal Server Error' };
    }
    
    const duration = Date.now() - startTime;
    fastify.log.info({ status, duration }, 'Request abgeschlossen');
    
    // Sende Antwort
    res.status(status).send(finalResult || {});
}

// Hauptroute
fastify.all('*', async (req: any, res: any) => {
    try {
        await doApi(req, res);
    } catch (err: any) {
        fastify.log.error(err, 'Kritischer Fehler');
        if (!res.sent) {
            res.status(500).send({ error: 'Internal Server Error' });
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
║  Proxy läuft auf: http://${host}:${port}           ║
║  Deemix URL: ${process.env.DEEMIX_URL || 'http://127.0.0.1:7272'}
║  Lidarr API: ${lidarrApiUrl}
║  Modus: ${process.env.PRIO_DEEMIX === 'true' ? 'Deemix-Priorität' : 'Standard'}
╚════════════════════════════════════════════════════╝
        `);
    } catch (err) {
        fastify.log.error(err, 'Server konnte nicht gestartet werden');
        process.exit(1);
    }
};

// Graceful Shutdown
process.on('SIGTERM', async () => {
    fastify.log.info('SIGTERM empfangen, fahre herunter...');
    await fastify.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    fastify.log.info('SIGINT empfangen, fahre herunter...');
    await fastify.close();
    process.exit(0);
});

start();