import fetch, { Response } from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import _ from "lodash";
import dotenv from "dotenv";
import { search, getAlbum, deemixArtist } from "./deemix.js";
import { removeKeys } from "./helpers.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const scrobblerApiUrl = "https://ws.audioscrobbler.com";

const fastify = Fastify({
  logger: false, // Wir verwenden console.log für mehr Kontrolle
});

// Zentraler Fehler-Handler, der sicherstellt, dass immer ein gültiges JSON gesendet wird.
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

/**
 * Parst eine Antwort sicher als JSON. Klont die Antwort, um "body used already"-Fehler zu vermeiden.
 */
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
    let lidarr: any = null;

    try {
        upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, {
            method,
            body: req.body ? req.body as string : undefined,
            headers: nh,
            timeout: 15000, // 15 Sekunden Timeout, um 524-Fehler zu vermeiden
        });
        status = upstreamResponse.status;
        lidarr = await safeParseJson(upstreamResponse);

        if (!upstreamResponse.ok) {
             console.warn(`Upstream API Fehler für ${url}. Status: ${status}`);
        }

    } catch (e) {
        console.error(`Netzwerkfehler oder Timeout beim Abruf von ${lidarrApiUrl}${url}:`, e);
        status = 502; // Bad Gateway
        lidarr = null; // Setze auf null, damit die Anreicherung von Deemix als Fallback starten kann
    }

    // Dies ist die Kernlogik: Wenn die Lidarr-API fehlschlägt (lidarr ist null)
    // oder keine Ergebnisse liefert, initialisieren wir für die Suche mit einem leeren Array.
    if (url.includes("/search") && !Array.isArray(lidarr)) {
        lidarr = [];
    }

    // Die Anreicherungslogik läuft jetzt immer, entweder mit Lidarr-Daten oder mit einer leeren Liste.
    if (url.includes("/v0.4/search")) {
        const queryParam = u.searchParams.get("query") || "";
        lidarr = await search(lidarr, queryParam, url.includes("type=all"));
    } else if (url.includes("/v0.4/artist/")) {
        const queryParam = u.searchParams.get("query") || "";
        const mbArtist = await getArtistData(queryParam);
        if (mbArtist?.Albums?.length > 0) {
            lidarr = mbArtist;
        } else {
            const id = url.includes("-aaaa-") ? url.split("/").pop()?.split("-").pop()?.replaceAll("a", "") : queryParam;
            if (id) {
                lidarr = await deemixArtist(id);
                if (!lidarr) status = 404;
            }
        }
    } else if (url.includes("/v0.4/album/")) {
        if (url.includes("-bbbb-")) {
            const id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
            if (id) {
                lidarr = await getAlbum(id);
                if (!lidarr) status = 404;
            }
        }
    }

    const responseHeaders: Record<string, any> = {};
    upstreamResponse?.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'content-encoding') {
            responseHeaders[key] = value;
        }
    });
    
    responseHeaders['content-type'] = 'application/json; charset=utf-8';
    
    if(status === 200 && (lidarr === null || (Array.isArray(lidarr) && lidarr.length === 0))) {
        status = 404;
    }

    console.log(`Anfrage: [${method}] ${url}, Antwort-Status: ${status}`);

    res.status(status).headers(responseHeaders).send(lidarr || {});
}

// Finaler, vereinfachter Handler mit robustem Fehler-Catching
fastify.all('*', async (req: FastifyRequest, res: FastifyReply) => {
    try {
        await doApi(req, res);
    } catch (err) {
        // Leitet jeden unerwarteten Fehler an den zentralen `setErrorHandler` weiter.
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