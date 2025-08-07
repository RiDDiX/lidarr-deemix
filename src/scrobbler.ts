import fetch from "node-fetch";
import { FastifyRequest, FastifyReply } from "fastify";
import { removeKeys } from "./helpers.js";

const scrobblerApi = "https://ws.audioscrobbler.com";

export async function proxyToScrobbler(req: FastifyRequest, reply: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const url = `${scrobblerApi}${u.pathname}${u.search}`;

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

  const res = await fetch(url, fetchOpts);
  let json = await res.json();

  if (process.env.OVERRIDE_MB === "true") {
    json = removeKeys(json, ["mbid"]);
  }

  reply.status(res.status).headers(res.headers.raw()).send(json);
}
