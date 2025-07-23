import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { deemixSearch, getArtist as getDeemixArtist, getAlbum } from "./deemix.js";
import { getArtistData } from "./artistData.js";
import { removeKeys } from "./helpers.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const fastify = Fastify({ logger: { level: "error" } });

fastify.setErrorHandler((error, request, reply) => {
  console.error("Error:", error);
  reply.status(500).send({ error: "Internal Server Error", message: error.message });
});

async function proxyLidarr(req: FastifyRequest, res: FastifyReply) {
  const url = new URL(`http://localhost${req.url}`);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection"].includes(k)));
  const method = req.method;
  const body = req.body ? JSON.stringify(req.body) : undefined;

  const fetchRes = await fetch(`${lidarrApiUrl}${url.pathname}${url.search}`, {
    method,
    headers,
    body,
  });

  const contentType = fetchRes.headers.get("content-type");
  const result = contentType?.includes("json") ? await fetchRes.json() : await fetchRes.text();
  res.status(fetchRes.status);
  fetchRes.headers.forEach((v, k) => res.header(k, v));

  // /search endpoint erweitern
  if (url.pathname.includes("/search") && process.env.FALLBACK_DEEZER === "true") {
    const queryParam = url.searchParams.get("query") || "";
    const fromLidarr = Array.isArray(result) ? result : [];
    const fromDeemix = await deemixSearch(queryParam);
    const merged = [...fromLidarr, ...fromDeemix];
    return merged;
  }

  // /artist fallback
  if (url.pathname.includes("/artist/")) {
    const queryParam = url.searchParams.get("query") || "";
    const mb = await getArtistData(queryParam);
    if (mb?.Albums?.length) return mb;

    if (url.pathname.includes("-aaaa-")) {
      const id = url.pathname.split("/").pop()?.split("-").pop()?.replaceAll("a", "");
      const deemixArtist = id ? await getDeemixArtist(id) : null;
      return deemixArtist ?? res.status(404).send({ error: "Not found" });
    }

    return await getDeemixArtist(queryParam);
  }

  // /album fallback
  if (url.pathname.includes("/album/") && url.pathname.includes("-bbbb-")) {
    const id = url.pathname.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
    const album = id ? await getAlbum(id) : null;
    return album ?? res.status(404).send({ error: "Not found" });
  }

  return result;
}

fastify.get("*", proxyLidarr);

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Lidarr++Deemix läuft auf ${address}`);
});
