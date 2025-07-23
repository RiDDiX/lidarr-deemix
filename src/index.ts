import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { deemixSearch, deemixArtist, getAlbum } from "./deemix.js";
import { removeKeys, normalize } from "./helpers.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const scrobblerApiUrl = "https://ws.audioscrobbler.com";

const fastify = Fastify({ logger: false });

fastify.setErrorHandler((error, req, res) => {
  console.error("Error:", error);
  res.status(500).send({ error: "Internal Server Error", message: error.message });
});

fastify.all("*", async (req: FastifyRequest, res: FastifyReply) => {
  const targetHost = req.headers["x-proxy-host"];

  const proxyUrl = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const headers = { ...req.headers } as Record<string, string>;
  delete headers.host;
  delete headers.connection;

  const fetchOptions: any = {
    method,
    headers,
  };

  if (method !== "GET" && method !== "HEAD" && req.body) {
    fetchOptions.body = typeof req.body === "object" ? JSON.stringify(req.body) : req.body.toString();
    if (!headers["content-type"]) fetchOptions.headers["content-type"] = "application/json";
  }

  try {
    let url = `${proxyUrl.pathname}${proxyUrl.search}`;
    let baseUrl = lidarrApiUrl;

    if (targetHost === "ws.audioscrobbler.com") baseUrl = scrobblerApiUrl;

    let response = await fetch(`${baseUrl}${url}`, fetchOptions);
    let data = await response.json();

    if (targetHost === "ws.audioscrobbler.com" && process.env.OVERRIDE_MB === "true") {
      data = removeKeys(data, ["mbid"]);
    }

    // Deezer Fallback
    if (process.env.FALLBACK_DEEZER === "true") {
      if (url.includes("/v0.4/search")) {
        const query = proxyUrl.searchParams.get("query") || "";
        const fallbackResults = await deemixSearch(query);
        if (fallbackResults && fallbackResults.length > 0) {
          return fallbackResults;
        }
      }

      if (url.includes("/v0.4/artist/")) {
        const query = proxyUrl.searchParams.get("query") || "";
        const artist = await getArtistData(query);
        if (artist) return artist;
      }

      if (url.includes("/v0.4/album/") && url.includes("-bbbb-")) {
        const id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
        if (id) {
          const album = await getAlbum(id);
          if (album) return album;
        }
      }
    }

    return data;
  } catch (e) {
    console.error("Proxy error:", e);
    res.status(502).send({ error: "Bad Gateway", message: e.message });
  }
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Lidarr-Deemix Proxy running at ${address}`);
});
