import Fastify from "fastify";
import dotenv from "dotenv";
import { proxyToLidarr } from "./lidarr.js";
import { proxyToScrobbler } from "./scrobbler.js";

dotenv.config();

const fastify = Fastify({ logger: false });

fastify.all("*", async (req, reply) => {
  const targetHost = req.headers["x-proxy-host"];
  if (targetHost === "ws.audioscrobbler.com") {
    return await proxyToScrobbler(req, reply);
  }
  return await proxyToLidarr(req, reply);
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🚀 Lidarr-Deemix Proxy läuft unter ${address}`);
});
