import fetch, { Response } from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { search, getFullArtist } from "./deemix.js";

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
        const foreignArtistId = u.searchParams.get('foreignArtistId') || ''; // Schau, ob wir eine Deemix-ID haben
        finalResult = await getFullArtist(artistId, foreignArtistId);
    } else {
        let lidarrResults: any[] = [];
        try {
            const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { method, headers: nh, timeout: 8000 });
            if (upstreamResponse.ok) {
                lidarrResults = await upstreamResponse.json() as any[];
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
    
    if (finalResult === null || (Array.isArray(finalResult) && finalResult.length === 0)) {
        status = 404;
    }

    res.status(status).send(finalResult || {});
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