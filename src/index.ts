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

async function doScrobbler(req: FastifyRequest, res: FastifyReply): Promise<{ newres: FastifyReply; data: any }> {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const body = req.body ? req.body.toString() : "";
  let status = 200;
  const nh: { [key: string]: any } = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") nh[key] = value;
  });
  const url = `${u.pathname}${u.search}`;
  let data;
  try {
  const fetchOpts: any = { method, headers: nh };
  if (!["GET", "HEAD"].includes(method.toUpperCase()) && body) {
    fetchOpts.body = body;
  }
  data = await fetch(`${lidarrApiUrl}${url}`, fetchOpts);
    status = data.status;
  } catch (e) {
    console.error(e);
  }
  res.statusCode = status;
  res.headers = data?.headers as any;
  let json = await data?.json();
  if (process.env.OVERRIDE_MB === "true") {
    json = removeKeys(json, ["mbid"]);
  }
  return { newres: res, data: json };
}

async function doApi(req: FastifyRequest, res: FastifyReply): Promise<{ newres: FastifyReply; data: any }> {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const body = req.body ? req.body.toString() : "";
  let status = 200;
  const nh: { [key: string]: any } = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") nh[key] = value;
  });
  const url = `${u.pathname}${u.search}`;
  let data;
  try {
  const fetchOpts: any = { method, headers: nh };
  if (!["GET", "HEAD"].includes(method.toUpperCase()) && body) {
    fetchOpts.body = body;
  }
  data = await fetch(`${lidarrApiUrl}${url}`, fetchOpts);
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
  if (url.includes("/v0.4/search")) {
    const queryParam = u.searchParams.get("query") || "";
    lidarr = await search(lidarr, queryParam, url.includes("type=all"));
  }
  if (url.includes("/v0.4/artist/")) {
    // Zuerst MusicBrainz-Daten abrufen
    const queryParam = u.searchParams.get("query") || "";
    const mbArtist = await getArtistData(queryParam);
    if (mbArtist && mbArtist.Albums && mbArtist.Albums.length > 0) {
      lidarr = mbArtist;
    } else {
      // Falls kein MB-Datensatz gefunden wurde, Fallback zu Deemix
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
  if (url.includes("/v0.4/album/")) {
    if (url.includes("-bbbb-")) {
      let id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
      if (id) {
        lidarr = await getAlbum(id);
        status = lidarr === null ? 404 : 200;
      }
    }
  }
  data?.headers.delete("content-encoding");
  console.log(status, method, url);
  res.statusCode = status;
  res.headers = data?.headers as any;
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
