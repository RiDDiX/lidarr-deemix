import fetch, { Response } from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import _ from "lodash";
import dotenv from "dotenv";
import { search, getAlbum, deemixArtist } from "./deemix.js";
import { removeKeys } from "./helpers.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";

const fastify = Fastify({
  logger: false,
});

fastify.setErrorHandler((error, request, reply) => {
  console.error("Zentraler Fehler-Handler wurde ausgelöst:", error);
  if (!reply.sent) {
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: error.name || "Internal Server Error",
      message: error.message,
    });
  }
});

async function safeParseJson(response: Response): Promise<any> {
  const clonedResponse = response.clone();
  try {
    return await response.json();
  } catch (e) {
    const textBody = await clonedResponse.text();
    console.warn(`Antwort konnte nicht als JSON geparst werden. Status: ${response.status}. Body:`, textBody.slice(0, 400));
    return null;
  }
}

async function doApi(req: FastifyRequest, res: FastifyReply) {
    const u = new URL(`http://localhost${req.url}`);
    const url = `${u.pathname}${u.search}`;
    const method = req.method;
    let status = 200;

    const nh: { [key: string]: any } = {};
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!['host', 'connection'].includes(key.toLowerCase())) nh[key] = value;
    });

    let upstreamResponse: Response | null = null;
    let finalResult: any = null;

    // Versuche zuerst, die offizielle API abzufragen
    try {
        upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, {
            method,
            body: req.body ? req.body as string : undefined,
            headers: nh,
            timeout: 10000,
        });
        status = upstreamResponse.status;
        finalResult = await safeParseJson(upstreamResponse);

        if (!upstreamResponse.ok) {
             console.warn(`Upstream API Fehler für ${url}. Status: ${status}`);
        }
    } catch (e) {
        console.error(`Netzwerkfehler oder Timeout beim Abruf von ${lidarrApiUrl}${url}:`, e);
        finalResult = null; // Setze auf null, damit der Fallback greift
    }

    // === KOMPLETT NEUE LOGIK FÜR /artist/ und /album/ ===
    // Diese Logik greift, wenn die offizielle API fehlschlägt ODER
    // wenn wir die Daten anreichern müssen.

    if (url.includes("/v0.4/artist/")) {
        // Extrahiere die ID aus dem Pfad, z.B. /api/v0.4/artist/ID_HIER
        const artistId = u.pathname.split('/').pop();
        if (artistId) {
            console.log(`Rufe Künstlerdetails für ID ${artistId} ab...`);
            if (artistId.startsWith('deez')) {
                finalResult = await deemixArtist(artistId);
            } else if (artistId.startsWith('mbid')) {
                finalResult = await getArtistData(artistId);
            }
            // Wenn die offizielle API erfolgreich war, finalResult beibehalten
        }
    } else if (url.includes("/v0.4/album/")) {
        const albumId = u.pathname.split('/').pop();
        if (albumId) {
            console.log(`Rufe Albumdetails für ID ${albumId} ab...`);
            if (albumId.startsWith('deez')) {
                finalResult = await getAlbum(albumId);
            } else if (albumId.startsWith('mbid')) {
                // MusicBrainz Alben werden über den Künstler geholt,
                // wenn Lidarr hier direkt fragt und die API down ist, können wir wenig tun.
                // Ein 404 ist hier die korrekte Antwort, wenn die API nicht antwortet.
                if (finalResult === null) status = 404;
            }
        }
    } else if (url.includes("/v0.4/search")) {
        // Stelle sicher, dass `finalResult` für Suchen immer ein Array ist.
        const lidarrResults = Array.isArray(finalResult) ? finalResult : [];
        const queryParam = u.searchParams.get("query") || "";
        finalResult = await search(lidarrResults, queryParam, url.includes("type=all"));
    }

    // Setze finalen Status
    if (finalResult === null || (Array.isArray(finalResult) && finalResult.length === 0)) {
        // Wenn am Ende nichts gefunden wurde, ist 404 korrekt.
        // Außer bei einer erfolgreichen leeren Suche, da ist 200 OK.
        if (status !== 200) {
           status = 404;
        }
    }
    
    const responseHeaders: Record<string, any> = {
        'content-type': 'application/json; charset=utf-8'
    };
    
    console.log(`Anfrage: [${method}] ${url}, Finale Antwort an Lidarr: Status ${status}`);

    res.status(status).headers(responseHeaders).send(finalResult || {});
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
  if (process.env.OVERRIDE_MB === "true") {
    console.log("WARNUNG: MusicBrainz API wird vollständig durch Deemix überschrieben.");
  }
});