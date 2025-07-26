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

fastify.setErrorHandler((error, request, reply) => {
  console.error("Zentraler Fehler-Handler wurde ausgelöst:", error);
  if (!reply.sent) {
    reply.status(500).send({ error: "Internal Server Error", message: error.message });
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
    
    // === DIE ENTSCHEIDENDE ÄNDERUNG ===
    // Wir tun immer so, als wäre alles gut, und starten mit Status 200 OK.
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
            timeout: 10000, // 10 Sekunden Timeout
        });
        
        if (upstreamResponse.ok) {
            lidarr = await safeParseJson(upstreamResponse);
        } else {
             console.warn(`Upstream API Fehler für ${url}. Status: ${upstreamResponse.status}`);
             lidarr = null; // Behandle es als Fehler, fahre aber fort.
        }

    } catch (e) {
        console.error(`Netzwerkfehler oder Timeout beim Abruf von ${lidarrApiUrl}${url}:`, e);
        lidarr = null; // Setze auf null, damit die Anreicherung von Deemix als Fallback startet.
    }

    // Stelle sicher, dass `lidarr` für Suchen immer ein Array ist.
    if (url.includes("/search") && !Array.isArray(lidarr)) {
        lidarr = [];
    }

    // Die Anreicherungslogik läuft jetzt immer, entweder mit den Daten von Lidarr oder mit einer leeren Liste.
    let finalResult = lidarr;
    if (url.includes("/v0.4/search")) {
        const queryParam = u.searchParams.get("query") || "";
        finalResult = await search(lidarr, queryParam, url.includes("type=all"));
    } else if (url.includes("/v0.4/artist/")) {
        const queryParam = u.searchParams.get("query") || "";
        const mbArtist = await getArtistData(queryParam);
        if (mbArtist?.Albums?.length > 0) {
            finalResult = mbArtist;
        } else {
            const id = url.includes("-aaaa-") ? url.split("/").pop()?.split("-").pop()?.replaceAll("a", "") : queryParam;
            if (id) {
                finalResult = await deemixArtist(id);
            }
        }
    } else if (url.includes("/v0.4/album/")) {
        if (url.includes("-bbbb-")) {
            const id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
            if (id) {
                finalResult = await getAlbum(id);
            }
        }
    }
    
    // Wenn am Ende kein Ergebnis gefunden wurde, setzen wir den Status auf 404.
    // Lidarr kann damit umgehen und zeigt "No results found" an.
    if (finalResult === null || (Array.isArray(finalResult) && finalResult.length === 0)) {
        status = 404;
    }

    const responseHeaders: Record<string, any> = {
        'content-type': 'application/json; charset=utf-8'
    };
    
    console.log(`Anfrage: [${method}] ${url}, Finale Antwort an Lidarr: Status ${status}`);

    // Sende die finale Antwort.
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