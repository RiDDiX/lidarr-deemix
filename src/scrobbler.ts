import { FastifyRequest, FastifyReply } from "fastify";
import { removeKeys } from "./helpers.js";

const scrobblerApi = "https://ws.audioscrobbler.com";

// Headers that should not be forwarded to the upstream server.
// accept-encoding: undici negotiates its own compression;
// content-length: recalculated for the (possibly re-serialized) body.
const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "x-proxy-host",
  "transfer-encoding",
  "accept-encoding",
  "content-length",
]);

// undici transparently decompresses responses, so content-encoding/content-length
// of the upstream response no longer match the body we send to Lidarr.
const SKIP_RESPONSE_HEADERS = new Set([
  "host",
  "connection",
  "x-proxy-host",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

export async function proxyToScrobbler(req: FastifyRequest, reply: FastifyReply) {
  const u = new URL(`http://localhost${req.url}`);
  const url = `${scrobblerApi}${u.pathname}${u.search}`;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string" && !SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  // Bodies arrive either as raw Buffer (non-JSON content types, see the
  // catch-all parser in index.ts) or as parsed JSON object
  let body: any = undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    body = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);
  }

  const fetchOpts: RequestInit = {
    method: req.method,
    headers,
    body,
    signal: AbortSignal.timeout(30000),
  };

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, fetchOpts);
    text = await res.text();
  } catch (error) {
    req.log.error({ err: error }, "Scrobbler upstream request failed");
    return reply.status(502).send({ error: "Upstream unavailable" });
  }

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    // 204 and some error replies carry a JSON content-type with an empty body
    if (!text) {
      return reply.status(res.status).headers(responseHeaders).send();
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      // HTML error pages sometimes arrive labelled as JSON - pass them through
      return reply.status(res.status).headers(responseHeaders).send(text);
    }
    if (process.env.OVERRIDE_MB === "true") {
      json = removeKeys(json, ["mbid"]);
    }
    reply.status(res.status).headers(responseHeaders).send(json);
  } else {
    // Non-JSON responses (e.g. XML) are passed through as-is
    reply.status(res.status).headers(responseHeaders).send(text);
  }
}
