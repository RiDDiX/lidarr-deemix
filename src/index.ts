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
  logger: { level: "error" },
});

// Zentraler Fehler-Handler
fastify.setErrorHandler((error, request, reply) => {
  console.error("Zentraler Fehler-Handler:", error);
  reply.status(500).send({ error: "Internal Server Error", message: error.message });
});

/**
 * Versucht, eine Antwort als JSON zu parsen.
 * Wenn es fehlschlägt, wird der Text-Body für das Debugging protokolliert
 * und ein sicherer Standardwert (z.B. null) zurückgegeben.
 */
async function safeParseJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch (e) {
    const textBody = await response.text();
    console.warn(`Antwort konnte nicht als JSON geparst werden. Status: ${response.status}. Body:`, textBody.slice(0, 500));
    return null; // Gibt null zurück, damit der Aufrufer damit umgehen kann
  }
}

async function doApi(req: FastifyRequest, res: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const url = `${u.pathname}${u.search}`;
  const method = req.method;
  let status = 200;
  
  // Header für den Upstream-Request vorbereiten
  const nh: { [key: string]: any } = {};
  Object.entries(req.headers).forEach(([key, value]) => {
    if (!['host', 'connection'].includes(key.toLowerCase())) nh[key] = value;
  });

  let upstreamResponse: Response | null = null;
  let lidarr: any = null;

  try {
    upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { 
      method, 
      body: req.body as (string | null), 
      headers: nh 
    });
    status = upstreamResponse.status;
    lidarr = await safeParseJson(upstreamResponse);
  } catch (e) {
    console.error(`Fehler beim Abruf von ${lidarrApiUrl}${url}:`, e);
    status = 502; // Bad Gateway
    lidarr = { error: "Upstream API fetch failed", details: (e as Error).message };
  }
  
  // Wenn Lidarr nichts findet (oder ein Fehler auftrat), mit einem leeren Array für die Suche initialisieren
  if (lidarr === null && url.includes("/search")) {
    lidarr = [];
  }
  
  try {
    // Anreicherungslogik
    if (url.includes("/v0.4/search")) {
      const queryParam = u.searchParams.get("query") || "";
      lidarr = await search(lidarr || [], queryParam, url.includes("type=all"));
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
  } catch(e) {
      console.error("Fehler bei der Datenanreicherung:", e);
      // Den ursprünglichen `lidarr`-Inhalt beibehalten, aber Fehler loggen
  }

  // Header für die Antwort an Lidarr vorbereiten
  const responseHeaders: Record<string, any> = {};
  upstreamResponse?.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-encoding') { // Verhindert Kompressionsprobleme
      responseHeaders[key] = value;
    }
  });

  console.log(`[${method}] ${status} ${url}`);
  
  // Stelle sicher, dass niemals null oder undefined als Body gesendet wird.
  // Lidarr erwartet immer ein JSON-Objekt.
  res.status(status).headers(responseHeaders).send(lidarr || {});
}

async function doScrobbler(req: FastifyRequest, res: FastifyReply) {
    // Implementierung für Scrobbler... (kann ähnlich wie doApi aufgebaut werden)
    res.status(501).send({error: "Not implemented"});
}

// Handler für alle Methoden, um GET, POST, etc. abzufangen
fastify.all('*', async (req: FastifyRequest, res: FastifyReply) => {
  const host = req.headers["x-proxy-host"];
  if (host === "ws.audioscrobbler.com") {
    return doScrobbler(req, res);
  }
  return doApi(req, res);
});


fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("Lidarr++Deemix Proxy running at " + address);
  if (process.env.OVERRIDE_MB === "true") {
    console.log("WARNUNG: MusicBrainz API wird vollständig durch Deemix überschrieben.");
  }
});