import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { getArtist, getAlbum, deemixArtist, deemixArtists } from "./deemix.js";
import { removeKeys } from "./helpers.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const fastify = Fastify({ logger: { level: "error" } });

// Offizieller API-Endpoint – wird genutzt, falls FALLBACK_DEEZER nicht aktiv ist.
const defaultLidarrApiUrl =
  process.env.LIDARR_API_URL || "https://api.lidarr.audio/api/v0.4";

// Liefert den Request-Body nur, wenn die Methode ihn zulässt.
function getRequestBody(req: FastifyRequest): undefined | string {
  return (req.method === "GET" || req.method === "HEAD")
    ? undefined
    : req.body ? req.body.toString() : undefined;
}

// Für GET /api/v0.4/search/artists: Musikbrainz-Abfrage, ggf. Fallback auf Deezer.
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

  // Nehmen wir an, der eingehende Pfad kann entweder mit "/api/v0.4" oder "/api/v1" beginnen.
  let urlPath = u.pathname;
  if (urlPath.startsWith("/api/v0.4")) {
    urlPath = urlPath.substring("/api/v0.4".length);
  } else if (urlPath.startsWith("/api/v1")) {
    urlPath = urlPath.substring("/api/v1".length);
  }
  if (!urlPath.startsWith("/")) {
    urlPath = "/" + urlPath;
  }
  urlPath = urlPath + u.search;

  // 1. Künstler-Suche
  if (u.pathname.startsWith("/api/v0.4/search/artists") || u.pathname.startsWith("/api/v1/search/artists")) {
    const data = await handleArtistSearch(req);
    res.statusCode = 200;
    return data;
  }

  // 2. Künstler-Details
  if (u.pathname.startsWith("/api/v0.4/artist/") || u.pathname.startsWith("/api/v1/artist/")) {
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

  // 3. Album-Anfragen (Beispiel: /api/v0.4/album/...)
  if (u.pathname.startsWith("/api/v0.4/album/") || u.pathname.startsWith("/api/v1/album/")) {
    if (u.pathname.includes("-bbbb-")) {
      let id = u.pathname.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
      if (id) {
        const albumData = await getAlbum(id);
        res.statusCode = albumData ? 200 : 404;
        return albumData;
      }
    }
  }
  
  // 4. Wenn FALLBACK_DEEZER true ist, greifen wir komplett auf den Deezer-Fallback.
  if (process.env.FALLBACK_DEEZER === "true") {
    const query = u.searchParams.get("query") || "";
    const fallback = await deemixArtist(query);
    res.statusCode = fallback ? 200 : 404;
    return fallback;
  }

  // 5. Standardweiterleitung an den offiziellen API-Endpoint.
  const finalUrl = `${defaultLidarrApiUrl}${urlPath}`;
  try {
    const fetchOptions: any = { method, headers };
    if (bodyValue !== undefined) fetchOptions.body = bodyValue;
    const response = await fetch(finalUrl, fetchOptions);
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
  return await doProxy(req, res);
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("Lidarr++Deemix Proxy running at " + address);
  if (process.env.OVERRIDE_MB === "true") {
    console.log("Overriding MusicBrainz API with Deezer fallback");
  }
});
