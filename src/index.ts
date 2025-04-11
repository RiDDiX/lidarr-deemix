import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import _ from "lodash";
import {
  search,
  getArtist,
  getAlbum,
  deemixArtist,
  deemixArtists,
} from "./deemix.js";
import { removeKeys } from "./helpers.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const fastify = Fastify({
  logger: { level: "error" },
});

// Falls in der Umgebungsvariable nichts gesetzt ist, verwenden wir standardmäßig:
// - Für "/api/v0.4": https://api.lidarr.audio/api/v0.4
// - Für "/api/v1": https://api.lidarr.audio/api/v1
// Diese Logik erkennen wir anhand des Request-Pfads.
function getTargetApiUrl(u: URL): string {
  let versionPrefix = "";
  if (u.pathname.startsWith("/api/v1")) {
    versionPrefix = "/api/v1";
  } else if (u.pathname.startsWith("/api/v0.4")) {
    versionPrefix = "/api/v0.4";
  }
  // Falls die Umgebungsvariable gesetzt ist, nutzen wir diese.
  // Ansonsten bauen wir den Standard zusammen:
  return process.env.LIDARR_API_URL || `https://api.lidarr.audio${versionPrefix}`;
}

// Liefert den Request-Body nur, wenn die Methode ihn zulässt.
function getRequestBody(req: FastifyRequest): undefined | string {
  return req.method === "GET" || req.method === "HEAD"
    ? undefined
    : req.body
    ? req.body.toString()
    : undefined;
}

// Für GET /api/v0.4/search/artists oder /api/v1/search/artists: MusikBrainz‑Abfrage, ggf. Fallback auf Deezer.
async function handleArtistSearch(req: FastifyRequest): Promise<any[]> {
  const u = new URL(`http://localhost${req.url}`);
  const query = u.searchParams.get("query") || "";
  if (process.env.FALLBACK_DEEZER === "true") {
    // Direkt über Deezer/Deemix suchen
    return await deemixArtists(query);
  }
  const musicBrainzUrl = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json`;
  try {
    const mbResponse = await fetch(musicBrainzUrl);
    const mbJson = await mbResponse.json();
    // Überprüfe, ob mbJson ein Objekt mit "artists" ist:
    const artists = Array.isArray(mbJson.artists) ? mbJson.artists : [];
    if (artists.length > 0) {
      return artists;
    } else {
      return await deemixArtists(query);
    }
  } catch (e: unknown) {
    console.error("Fehler bei MusicBrainz-Abruf:", e);
    return await deemixArtists(query);
  }
}

// Haupt-Proxy-Funktion: Leitet Anfragen anhand des Pfads um.
async function doProxy(req: FastifyRequest, res: FastifyReply): Promise<any> {
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const bodyValue = getRequestBody(req);
  const headers: { [key: string]: any } = {};
  Object.entries(req.headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") headers[key] = value;
  });

  // Erkenne den Version-Präfix ("/api/v1" oder "/api/v0.4") und entferne ihn für den finalen Pfad.
  let versionPrefix = "";
  if (u.pathname.startsWith("/api/v1")) {
    versionPrefix = "/api/v1";
  } else if (u.pathname.startsWith("/api/v0.4")) {
    versionPrefix = "/api/v0.4";
  }
  let urlPath = u.pathname.substring(versionPrefix.length);
  if (!urlPath.startsWith("/")) {
    urlPath = "/" + urlPath;
  }
  urlPath = urlPath + u.search;

  // Bestimme die Ziel-URL anhand des erkannte API-Version-Präfixes.
  const targetApiUrl = getTargetApiUrl(u);
  const finalUrl = `${targetApiUrl}${urlPath}`;

  // Spezielle Behandlung: Wenn die Anfrage eine Künstler-Suche betrifft.
  if (
    u.pathname.startsWith("/api/v0.4/search/artists") ||
    u.pathname.startsWith("/api/v1/search/artists")
  ) {
    const data = await handleArtistSearch(req);
    res.statusCode = 200;
    return data;
  }

  // Künstler-Details:
  if (
    u.pathname.startsWith("/api/v0.4/artist/") ||
    u.pathname.startsWith("/api/v1/artist/")
  ) {
    const query = u.searchParams.get("query") || "";
    if (process.env.FALLBACK_DEEZER === "true") {
      const fallback = await deemixArtist(query);
      res.statusCode = fallback ? 200 : 404;
      return fallback;
    }
    const mbData = getArtistData(query);
    if (mbData && mbData.albums && mbData.albums.length > 0) {
      res.statusCode = 200;
      return mbData;
    } else {
      const fallback = await deemixArtist(query);
      res.statusCode = fallback ? 200 : 404;
      return fallback;
    }
  }

  // Album-Anfragen (Beispiel: /api/v0.4/album/... oder /api/v1/album/...)
  if (
    u.pathname.startsWith("/api/v0.4/album/") ||
    u.pathname.startsWith("/api/v1/album/")
  ) {
    if (u.pathname.includes("-bbbb-")) {
      let id = u.pathname.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
      if (id) {
        const albumData = await getAlbum(id);
        res.statusCode = albumData ? 200 : 404;
        return albumData;
      }
    }
  }

  // Fallback: Wenn FALLBACK_DEEZER true ist, komplett auf Deezer zurückgreifen.
  if (process.env.FALLBACK_DEEZER === "true") {
    const query = u.searchParams.get("query") || "";
    const fallback = await deemixArtist(query);
    res.statusCode = fallback ? 200 : 404;
    return fallback;
  }

  // Standardweiterleitung an den offiziellen API-Endpoint.
  try {
    const fetchOptions: any = { method, headers };
    if (bodyValue !== undefined) fetchOptions.body = bodyValue;
    const response = await fetch(finalUrl, fetchOptions);
    // Falls offizielle API fehlerhaft antwortet und FALLBACK_DEEZER aktiv ist:
    if (!response.ok && process.env.FALLBACK_DEEZER === "true") {
      console.error(`Fehler vom offiziellen API-Endpoint (Status: ${response.status}). Fallback auf Deezer.`);
      const query = u.searchParams.get("query") || "";
      try {
        const fallbackData = await deemixArtist(query);
        res.statusCode = fallbackData ? 200 : response.status;
        return fallbackData;
      } catch (fallbackError: unknown) {
        console.error("Fallback über Deezer schlug fehl:", fallbackError);
        res.statusCode = 500;
        const errorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return { error: "Fallback Error", message: errorMsg };
      }
    }
    res.statusCode = response.status;
    const json = await response.json();
    return json;
  } catch (e: unknown) {
    console.error("Fehler beim Abruf vom offiziellen API-Endpoint:", e);
    if (process.env.FALLBACK_DEEZER === "true") {
      const query = u.searchParams.get("query") || "";
      try {
        const fallbackData = await deemixArtist(query);
        res.statusCode = fallbackData ? 200 : 500;
        return fallbackData;
      } catch (fallbackError: unknown) {
        console.error("Fallback über Deezer schlug ebenfalls fehl:", fallbackError);
        res.statusCode = 500;
        const errorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return { error: "Fallback Error", message: errorMsg };
      }
    }
    res.statusCode = 500;
    const errorMsg = e instanceof Error ? e.message : String(e);
    return { error: "Internal Server Error", message: errorMsg };
  }
}

fastify.get("*", async (req: FastifyRequest, res: FastifyReply) => {
  const host = req.headers["x-proxy-host"];
  if (host === "ws.audioscrobbler.com") {
    const { newres, data } = await doScrobbler(req, res);
    res = newres;
    return data;
  } else {
    const { newres, data } = await doApi(req, res);
    res = newres;
    return data;
  }
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("Lidarr++Deemix running at " + address);
  if (process.env.OVERRIDE_MB === "true") {
    console.log("Overriding MusicBrainz API with Deemix API");
  }
});
