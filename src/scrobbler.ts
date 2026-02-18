import { FastifyRequest, FastifyReply } from "fastify";
import { removeKeys } from "./helpers.js";

const scrobblerApi = "https://ws.audioscrobbler.com";

// Headers that should not be forwarded to the upstream server
const SKIP_HEADERS = new Set(["host", "connection", "x-proxy-host", "transfer-encoding"]);

export async function proxyToScrobbler(req: FastifyRequest, reply: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const url = `${scrobblerApi}${u.pathname}${u.search}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && !SKIP_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  const fetchOpts: RequestInit = {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
  };

  const res = await fetch(url, fetchOpts);

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    let json: any = await res.json();
    if (process.env.OVERRIDE_MB === "true") {
      json = removeKeys(json, ["mbid"]);
    }
    reply.status(res.status).headers(responseHeaders).send(json);
  } else {
    // Non-JSON responses (e.g. XML) are passed through as-is
    const data = await res.text();
    reply.status(res.status).headers(responseHeaders).send(data);
  }
}
