import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { search, getDeemixArtistById, getAlbumById } from "./deemix.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const fastify = Fastify({ logger: false });

// Zentraler Fehler-Handler, um Abstürze zu vermeiden
fastify.setErrorHandler((error, request, reply) => {
  console.error("Ein zentraler Fehler wurde abgefangen:", error);
  if (!reply.sent) {
    reply.status(500).send({ error: "Internal Server Error", message: error.message });
  }
});

async function doApi(req: FastifyRequest, res: FastifyReply) {
    const u = new URL(`http://localhost${req.url}`);
    const url = `${u.pathname}${u.search}`;
    const method = req.method;
    let status = 200;

    const nh: { [key: string]: any } = {};
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!['host', 'connection'].includes(key.toLowerCase())) nh[key] = value;
    });

    let finalResult: any = null;

    // Abfrage für einen bestimmten Künstler
    if (url.includes("/v0.4/artist/")) {
        const artistId = u.pathname.split('/').pop() || '';
        
        // Deemix-Künstler anhand der Fake-ID erkennen
        if (artistId.startsWith('aaaaaaaa')) { 
            console.log(`Anfrage für Deemix-Künstler mit Fake-ID ${artistId}`);
            finalResult = await getDeemixArtistById(artistId);
        } else { // MusicBrainz-Künstler
            console.log(`Anfrage für MusicBrainz-Künstler mit MBID ${artistId}`);
            finalResult = await getArtistData(artistId);
        }
        
        // Wenn kein Künstler gefunden wurde (egal warum), 404 senden, um Lidarr-Absturz zu verhindern
        if (finalResult === null) {
            status = 404;
        }

    // Abfrage für ein bestimmtes Album
    } else if (url.includes("/v0.4/album/")) {
        const albumId = u.pathname.split('/').pop() || '';
        if (albumId.startsWith('bbbbbbbb')) {
             console.log(`Anfrage für Deemix-Album mit Fake-ID ${albumId}`);
             finalResult = await getAlbumById(albumId);
             status = finalResult === null ? 404 : 200;
        } else {
            // Für Alben von MusicBrainz leiten wir einfach weiter
            try {
                 const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { method, headers: nh, timeout: 8000 });
                 status = upstreamResponse.status;
                 if (upstreamResponse.ok) {
                    finalResult = await upstreamResponse.json();
                 }
            } catch (e) {
                console.warn(`Lidarr API für Album ${albumId} nicht erreichbar.`);
                status = 404;
            }
        }

    } else { // Alle anderen Anfragen (inklusive Suche)
        let lidarrResults: any[] = [];
        try {
            // Versuche, Ergebnisse von der Lidarr-API (MusicBrainz) zu erhalten
            const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { method, headers: nh, timeout: 8000 });
            status = upstreamResponse.status;
            if (upstreamResponse.ok) {
                const parsed = await upstreamResponse.json();
                lidarrResults = Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {
            console.warn("Lidarr API (MusicBrainz) ist nicht erreichbar. Fahre nur mit Deemix fort.");
            // Setze den Status zurück, da wir einen Fallback haben
            status = 200;
        }

        // Wenn es eine Suchanfrage ist, reichern wir die Ergebnisse mit Deemix an
        if (url.includes("/v0.4/search")) {
            const queryParam = u.searchParams.get("query") || "";
            finalResult = await search(lidarrResults, queryParam);
        } else {
            finalResult = lidarrResults;
        }
    }
    
    // Wenn eine Suche oder Abfrage kein Ergebnis liefert, ist 404 der korrekte Status für Lidarr
    if (finalResult === null || (Array.isArray(finalResult) && finalResult.length === 0)) {
        status = 404;
        finalResult = {}; // Sende ein leeres Objekt statt null
    }

    console.log(`Finale Antwort für ${url}: Status ${status}`);
    res.status(status).send(finalResult);
}

// Route für alle Anfragen definieren
fastify.all('*', async (req: FastifyRequest, res: FastifyReply) => {
    // Der Host-Header "X-Proxy-Host" wird von mitmproxy gesetzt
    const host = req.headers["x-proxy-host"];

    if (host === "ws.audioscrobbler.com") {
        // Last.fm Anfragen werden separat behandelt
        await proxyToScrobbler(req, res);
    } else {
        // Alle anderen (api.lidarr.audio) werden von unserer Hauptlogik verarbeitet
        await doApi(req, res);
    }
});

// Proxy-Funktion für Last.fm/Scrobbler
async function proxyToScrobbler(req: FastifyRequest, reply: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const url = `https://ws.audioscrobbler.com${u.pathname}${u.search}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && !["host", "connection", "x-proxy-host"].includes(key)) {
      headers[key] = value;
    }
  }

  const fetchOpts = {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body as any : undefined,
  };

  const res = await fetch(url, fetchOpts);
  const json = await res.json();
  
  reply.status(res.status).headers(res.headers.raw()).send(json);
}


fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("✅ Lidarr++Deemix Proxy läuft jetzt stabil unter " + address);
});