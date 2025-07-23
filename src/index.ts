import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { removeKeys } from "./helpers.js";
import { getArtistData } from "./artistData.js";
import { search, getAlbum, deemixArtist } from "./deemix.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const scrobblerApiUrl = "https://ws.audioscrobbler.com";

const fastify = Fastify({
  logger: { level: "error" },
});

fastify.setErrorHandler((error, request, reply) => {
  console.error("Error:", error);
  reply.status(500).send({ error: "Internal Server Error", message: error.message });
});

async function doScrobbler(req: FastifyRequest, res: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && key !== "host" && key !== "connection") {
      headers[key] = value;
    }
  }

  const url = `${u.pathname}${u.search}`;
  let status = 200;
  let data;

  try {
    const fetchOpts: any = { method, headers };
    if (method !== "GET" && method !== "HEAD" && req.body) {
      fetchOpts.body = typeof req.body === "object" ? JSON.stringify(req.body) : req.body.toString();
    }
    data = await fetch(`${scrobblerApiUrl}${url}`, fetchOpts);
    status = data.status;
  } catch (e) {
    console.error(e);
  }

  res.statusCode = status;
  if (data?.headers) {
    res.headers = data.headers as any;
  }

  let json = await data?.json();
  if (process.env.OVERRIDE_MB === "true") {
    json = removeKeys(json, ["mbid"]);
  }

  return { newres: res, data: json };
}

async function doApi(req: FastifyRequest, res: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && key !== "host" && key !== "connection") {
      headers[key] = value;
    }
  }

  const url = `${u.pathname}${u.search}`;
  let status = 200;
  let data;

  const fetchOpts: any = { method, headers };
  if (method !== "GET" && method !== "HEAD" && req.body) {
    fetchOpts.body = typeof req.body === "object" ? JSON.stringify(req.body) : req.body.toString();
    if (!fetchOpts.headers["content-type"]) {
      fetchOpts.headers["content-type"] = "application/json";
    }
  }

  try {
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
    const queryParam = u.searchParams.get("query") || "";
    const mbArtist = await getArtistData(queryParam);
    if (mbArtist && mbArtist.Albums?.length > 0) {
      lidarr = mbArtist;
    } else {
      if (url.includes("-aaaa-")) {
        const id = url.split("/").pop()?.split("-").pop()?.replaceAll("a", "");
        lidarr = id ? await deemixArtist(id) : null;
        status = lidarr === null ? 404 : 200;
      } else {
        lidarr = await deemixArtist(queryParam);
      }
    }
  }

  if (url.includes("/v0.4/album/") && url.includes("-bbbb-")) {
    const id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
    lidarr = id ? await getAlbum(id) : null;
    status = lidarr === null ? 404 : 200;
  }

  data?.headers?.delete("content-encoding");

  console.log(status, method, url);
  res.statusCode = status;
  if (data?.headers) {
    res.headers = data.headers as any;
  }

  return { newres: res, data: lidarr };
}

fastify.get("*", async (req: FastifyRequest, res: FastifyReply) => {
  const host = req.headers["x-proxy-host"];
  if (host === "ws.audioscrobbler.com") {
    const { data } = await doScrobbler(req, res);
    return data;
  }
  const { data } = await doApi(req, res);
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
