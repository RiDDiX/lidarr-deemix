import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import _ from "lodash";
import {
  getArtist,
  getAlbum,
  deemixArtist,
  deemixArtists,
} from "./deemix.js";
import { removeKeys } from "./helpers.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const fastify = Fastify({ logger: { level: "error" } });

// Unsere Ziel-API-URLs:
// Für "/api/v0.4" und "/api/v1" erwarten wir unterschiedliche Endpunkte.
const defaultLidarrApiUrlV04 = process.env.LIDARR_API_URL || "https://api.lidarr.audio/api/v0.4";
const defaultLidarrApiUrlV1 = process.env.LIDARR_API_URL || "https://api.lidarr.audio/api/v1";
const scrobblerApiUrl = "https://ws.audioscrobbler.com";

// Hilfsfunktion: Entferne den Version-Präfix vom eingehenden Pfad
function rewriteUrl(u: URL): { path: string; version: string } {
  let version = "";
  if (u.pathname.startsWith("/api/v1")) {
    version = "/api/v1";
  } else if (u.pathname.startsWith("/api/v0.4")) {
    version = "/api/v0.4";
  }
  let path = u.pathname.substring(version.length);
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return { path: path + u.search, version };
}

// Liefert den Request-Body nur, wenn die Methode ihn zulässt.
function getRequestBody(req: FastifyRequest): undefined | string {
  return req.method === "GET" || req.method === "HEAD"
    ? undefined
    : req.body
    ? req.body.toString()
    : undefined;
}

// doScrobbler: Behandelt Anfragen für den Scrobbler (Last.fm)
async function doScrobbler(req: FastifyRequest, res: FastifyReply): Promise<{ newres: FastifyReply; data: any }> {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const body = req.body ? req.body.toString() : undefined;
  const nh: any = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") {
      nh[key] = value;
    }
  });
  const url = `${u.pathname}${u.search}`;
  let data: any;
  try {
    data = await fetch(`${scrobblerApiUrl}${url}`, {
      method: method,
      body: body,
      headers: nh,
    });
  } catch (e) {
    console.error("Error in doScrobbler fetch:", e);
    res.statusCode = 500;
    return { newres: res, data: { error: "Scrobbler fetch error" } };
  }
  res.statusCode = data.status;
  // Setze Response-Header über res.header()
  data.headers.forEach((value: string, key: string) => {
    res.header(key, value);
  });
  let json = await data.json();
  if (process.env.OVERRIDE_MB === "true") {
    json = removeKeys(json, ["mbid"]);
  }
  return { newres: res, data: json };
}

// doApi: Behandelt Anfragen an die Lidarr-API.
async function doApi(req: FastifyRequest, res: FastifyReply): Promise<{ newres: FastifyReply; data: any }> {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const bodyValue = getRequestBody(req);
  const nh: any = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") {
      nh[key] = value;
    }
  });

  // Schreibe den URL um: Entferne Version-Präfix
  const { path, version } = rewriteUrl(u);
  // Wähle die Zielbasis-URL basierend auf der API-Version.
  const targetApiUrl = version === "/api/v1" ? defaultLidarrApiUrlV1 : defaultLidarrApiUrlV04;
  const finalUrl = `${targetApiUrl}${path}`;

  let response: any;
  try {
    const fetchOptions: any = { method, headers: nh };
    if (bodyValue !== undefined) fetchOptions.body = bodyValue;
    response = await fetch(finalUrl, fetchOptions);
  } catch (e: unknown) {
    console.error("Error fetching from official API:", e);
    res.statusCode = 500;
    return { newres: res, data: { error: "Internal Server Error", message: e instanceof Error ? e.message : String(e) } };
  }
  let lidarr: any;
  try {
    lidarr = await response.json();
  } catch (e: unknown) {
    console.error("Error parsing JSON from official API:", e);
    res.statusCode = 500;
    return { newres: res, data: { error: "Internal Server Error", message: "Invalid JSON response" } };
  }
  
  // Zusätzliche Verarbeitung basierend auf dem Pfad:
  if (u.pathname.includes("/search")) {
    lidarr = await search(lidarr, u.searchParams.get("query") as string, u.search.includes("type=all"));
  }
  if (u.pathname.includes("/artist/")) {
    if (u.pathname.includes("-aaaa-")) {
      let id = u.pathname.split("/").pop()?.split("-").pop()?.replaceAll("a", "");
      lidarr = await deemixArtist(id!);
      res.statusCode = lidarr === null ? 404 : 200;
    } else {
      lidarr = await getArtist(lidarr);
      if (process.env.OVERRIDE_MB === "true") {
        res.statusCode = 404;
        lidarr = {};
      }
    }
  }
  if (u.pathname.includes("/album/")) {
    if (u.pathname.includes("-bbbb-")) {
      let id = u.pathname.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
      lidarr = await getAlbum(id!);
      res.statusCode = lidarr === null ? 404 : 200;
    }
  }
  
  // Setze Header der offiziellen Antwort in FastifyReply
  if (response.headers && response.headers.forEach) {
    response.headers.forEach((value: string, key: string) => {
      res.header(key, value);
    });
  }
  
  console.log(response.status, method, u.pathname + u.search);
  res.statusCode = response.status;
  return { newres: res, data: lidarr };
}

fastify.get("*", async (req: FastifyRequest, res: FastifyReply) => {
  const host = req.headers["x-proxy-host"];
  if (host === "ws.audioscrobbler.com") {
    const { newres, data } = await doScrobbler(req, res);
    return data;
  } else {
    const { newres, data } = await doApi(req, res);
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
