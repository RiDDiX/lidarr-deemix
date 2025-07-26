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
  console.error("Zentraler Fehler-Handler erfasst:", error);
  // Sende eine generische JSON-Fehlermeldung
  if (!reply.sent) {
    reply.status(500).send({ error: "Internal Server Error", message: error.message });
  }
});

/**
 * Parst eine Antwort sicher als JSON. Klont die Antwort, um den "body used already"-Fehler zu vermeiden.
 */
async function safeParseJson(response: Response): Promise<any> {
  // Klone die Antwort, da der Body nur einmal gelesen werden kann.
  const clonedResponse = response.clone();
  try {
    return await response.json();
  } catch (e) {
    // Wenn JSON-Parsing fehlschlägt, logge den Text für Debugging-Zwecke vom Klon.
    const textBody = await clonedResponse.text();
    console.warn(`Antwort konnte nicht als JSON geparst werden. Status: ${response.status}. Body:`, textBody.slice(0, 500));
    return null; // Gibt null zurück, damit der Aufrufer damit umgehen kann.
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
  let lidarr: any = null; // Wichtig: Startet als null

  try {
    upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, {
      method,
      body: req.body ? req.body as string : undefined,
      headers: nh
    });
    status = upstreamResponse.status;
    if (upstreamResponse.ok) {
        lidarr = await safeParseJson(upstreamResponse);
    } else {
        console.warn(`Upstream API Fehler für ${url}. Status: ${status}`);
        // Behandle den Fall, dass Lidarr einen Fehler zurückgibt (z.B. 404), aber trotzdem JSON sendet
        lidarr = await safeParseJson(upstreamResponse) || null;
    }
  } catch (e) {
    console.error(`Netzwerkfehler beim Abruf von ${lidarrApiUrl}${url}:`, e);
    status = 502; // Bad Gateway
    lidarr = null;
  }
  
  // === KORREKTUR für "not iterable" ===
  // Stelle sicher, dass `lidarr` ein Array ist, bevor es an `search` übergeben wird.
  if (url.includes("/search") && !Array.isArray(lidarr)) {
    lidarr = [];
  }
  
  try {
    // Anreicherungslogik
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
  } catch(e) {
      console.error("Fehler bei der Datenanreicherung:", e);
      // Im Fehlerfall den Status auf 500 setzen und eine Fehlermeldung zurückgeben
      status = 500;
      lidarr = { error: "Fehler bei der Datenanreicherung", details: (e as Error).message };
  }

  const responseHeaders: Record<string, any> = {};
  upstreamResponse?.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-encoding') {
      responseHeaders[key] = value;
    }
  });

  console.log(`[${method}] ${status} ${url}`);
  
  // Finale Sicherheitsprüfung: Sende immer ein gültiges JSON-Objekt.
  // Auch bei einem Fehler ist `lidarr` jetzt ein serialisierbares Objekt.
  res.status(status).headers(responseHeaders).send(lidarr || {});
}

async function doScrobbler(req: FastifyRequest, res: FastifyReply) {
    res.status(501).send({error: "Not implemented"});
}

fastify.all('*', async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const host = req.headers["x-proxy-host"];
    if (host === "ws.audioscrobbler.com") {
      await doScrobbler(req, res);
    } else {
      await doApi(req, res);
    }
  } catch (error) {
      // Fange alle nicht behandelten Fehler in der Route ab und leite sie an den Handler weiter
      res.send(error);
  }
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