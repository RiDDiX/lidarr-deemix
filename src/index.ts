import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { search, getDeemixArtistById, getRealDeemixId } from "./deemix.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const fastify = Fastify({ logger: false });

fastify.setErrorHandler((error, request, reply) => {
  console.error("Zentraler Fehler-Handler wurde ausgelöst:", error);
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

    if (url.includes("/v0.4/artist/")) {
        const artistId = u.pathname.split('/').pop() || '';
        
        if (artistId.startsWith('aaaaaaaa')) { 
            console.log(`Anfrage für Deemix-Künstler mit Fake-ID ${artistId}`);
            const realDeemixId = getRealDeemixId(artistId);
            finalResult = await getDeemixArtistById(realDeemixId);
        } else { 
            console.log(`Anfrage für MusicBrainz-Künstler mit MBID ${artistId}`);
            finalResult = await getArtistData(artistId);
        }
        
        // === DER ENTSCHEIDENDE FIX ===
        // Wenn wir keinen vollständigen Künstler gefunden haben (egal warum),
        // senden wir einen 404, damit Lidarr nicht abstürzt.
        if (finalResult === null) {
            status = 404;
        }

    } else { // Alle anderen Anfragen (inkl. Suche)
        let lidarrResults: any = [];
        try {
            const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { method, headers: nh, timeout: 8000 });
            if (upstreamResponse.ok) {
                const parsed = await upstreamResponse.json();
                lidarrResults = Array.isArray(parsed) ? parsed : [];
            }
        } catch (e) {
            console.warn("Lidarr API nicht erreichbar, fahre nur mit Deemix fort.");
        }

        if (url.includes("/v0.4/search")) {
            const queryParam = u.searchParams.get("query") || "";
            finalResult = await search(lidarrResults, queryParam);
        } else {
            finalResult = lidarrResults;
        }
    }
    
    // Wenn eine Suche kein Ergebnis liefert, ist 404 trotzdem der korrekte Status.
    if (Array.isArray(finalResult) && finalResult.length === 0) {
        status = 404;
    }

    console.log(`Finale Antwort für ${url}: Status ${status}`);
    res.status(status).send(finalResult || {}); // Sende leeres Objekt bei 404
}

fastify.all('*', async (req: FastifyRequest, res: FastifyReply) => {
    try {
        await doApi(req, res);
    } catch (err) {
        res.send(err);
    }
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("✅ Lidarr++Deemix Proxy läuft jetzt stabil unter " + address);
});