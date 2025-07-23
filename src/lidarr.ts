import fetch from "node-fetch";
import { FastifyRequest, FastifyReply } from "fastify";
import { deemixSearch, deemixArtist, deemixAlbum } from "./deemix.js";
import { normalize } from "./helpers.js";

const lidarrApi = "https://api.lidarr.audio";

export async function proxyToLidarr(req: FastifyRequest, reply: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const url = `${lidarrApi}${u.pathname}${u.search}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && !["host", "connection"].includes(key)) {
      headers[key] = value;
    }
  }

  const fetchOpts: any = {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
  };

  let res = await fetch(url, fetchOpts);
  let json = await res.json();

  if (u.pathname.includes("/search") && process.env.FALLBACK_DEEZER === "true") {
    const query = u.searchParams.get("query") || "";
    const dee = await deemixSearch(query);
    json = [...json, ...dee];
  }

  if (u.pathname.includes("/artist/")) {
    const id = u.pathname.split("/").pop()!;
    if (id.includes("-aaaa-")) {
      const numericId = id.split("-").pop()?.replaceAll("a", "");
      json = await deemixArtist(numericId || "");
    }
  }

  if (u.pathname.includes("/album/")) {
    const id = u.pathname.split("/").pop()!;
    if (id.includes("-bbbb-")) {
      const numericId = id.split("-").pop()?.replaceAll("b", "");
      json = await deemixAlbum(numericId || "");
    }
  }

  reply.status(res.status).headers(res.headers.raw()).send(json);
}
