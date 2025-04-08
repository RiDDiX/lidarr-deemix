// index.ts
import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import _ from "lodash";
import dotenv from "dotenv";
import { search, getArtist, getAlbum, deemixArtist } from "./deemix.js";
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
  console.error("Error:", error);
  reply.status(500).send({ error: "Internal Server Error", message: error.message });
});

// Hilfsfunktion: Liefert den Body nur, wenn die Methode das erlaubt
function getRequestBody(req: FastifyRequest): undefined | string {
  // GET und HEAD dürfen keinen Body haben
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  return req.body ? req.body.toString() : undefined;
}

async function doScrobbler(req: FastifyRequest, res: FastifyReply): Promise<{ newres: FastifyReply; data: any }> {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const bodyValue = getRequestBody(req); // Body nur verwenden, wenn erlaubt
  let status = 200;
  
  // Kopiere alle Header außer "host" und "connection"
  const nh: { [key: string]: any } = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") {
      nh[key] = value;
    }
  });
  
  const url = `${u.pathname}${u.search}`;
  let data;
  try {
    const fetchOptions: any = { method, headers: nh };
    if (bodyValue !== undefined) {
      fetchOptions.body = bodyValue;
    }
    data = await fetch(`${scrobblerApiUrl}${url}`, fetchOptions);
    status = data.status;
  } catch (e) {
    console.error(e);
  }
  
  res.statusCode = status;
  res.headers = data?.headers || {};
  
  // Versuche, die Antwort als JSON zu parsen
  let json;
  try {
    json = await data?.json();
  } catch (e) {
    console.error("Fehler beim Parsen des JSON:", e);
    json = {};
  }
  
  if (process.env.OVERRIDE_MB === "true") {
    json = removeKeys(json, ["mbid"]);
  }
  return { newres: res, data: json };
}

async function doApi(req: FastifyRequest, res: FastifyReply): Promise<{ newres: FastifyReply; data: any }> {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const bodyValue = getRequestBody(req); // Nur Body verwenden, wenn erlaubt
  let status = 200;
  
  // Kopiere alle Header außer "host" und "connection"
  const nh: { [key: string]: any } = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") {
      nh[key] = value;
    }
  });
  
  const url = `${u.pathname}${u.search}`;
  let data;
  try {
    const fetchOptions: any = { method, headers: nh };
    if (bodyValue !== undefined) {
      fetchOptions.body = bodyValue;
    }
    data = await fetch(`${lidarrApiUrl}${url}`, fetchOptions);
    status = data.status;
  } catch (e) {
    console.error(e);
  }
  
  let lidarr: any;
  try {
    lidarr = await data?.json();
  } catch (e) {
    console.error(e);
  }
  
  // Suche nach /v0.4/search
  if (url.includes("/v0.4/search")) {
    const queryParam = u.searchParams.get("query") || "";
    lidarr = await search(lidarr, queryParam, url.includes("type=all"));
  }
  
  // Für /v0.4/artist/ wird zuerst MusicBrainz abgerufen, dann ggf. Fallback zu Deemix
  if (url.includes("/v0.4/artist/")) {
    const queryParam = u.searchParams.get("query") || "";
    const mbArtist = await getArtistData(queryParam);
    if (mbArtist && mbArtist.Albums && mbArtist.Albums.length > 0) {
      lidarr = mbArtist;
    } else {
      if (url.includes("-aaaa-")) {
        let id = url.split("/").pop()?.split("-").pop()?.replaceAll("a", "");
        if (id) {
          lidarr = await deemixArtist(id);
          status = lidarr === null ? 404 : 200;
        }
      } else {
        lidarr = await deemixArtist(queryParam);
      }
    }
  }
  
  // Für /v0.4/album/ Fallback zu getAlbum
  if (url.includes("/v0.4/album/")) {
    if (url.includes("-bbbb-")) {
      let id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
      if (id) {
        lidarr = await getAlbum(id);
        status = lidarr === null ? 404 : 200;
      }
    }
  }
  
  if (data?.headers && data.headers.delete) {
    data.headers.delete("content-encoding");
  }
  
  console.log(status, method, url);
  res.statusCode = status;
  res.headers = data?.headers || {};
  return { newres: res, data: lidarr };
}

fastify.get("*", async (req: FastifyRequest, res: FastifyReply) => {
  const headers = req.headers;
  const host = headers["x-proxy-host"];
  if (host === "ws.audioscrobbler.com") {
    const { newres, data } = await doScrobbler(req, res);
    return data;
  }
  const { newres, data } = await doApi(req, res);
  return data;
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
