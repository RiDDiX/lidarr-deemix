import fetch from "node-fetch";
import Fastify from "fastify";
import _ from "lodash";
import dotenv from "dotenv";
import {
  search,
  getArtist,
  getAlbum,
  deemixArtist,
  deemixAlbum,
  deemixTracks,
} from "./deemix.js";
import { removeKeys } from "./helpers.js";

const lidarrApiUrl = "https://api.lidarr.audio";
const scrobblerApiUrl = "https://ws.audioscrobbler.com";

dotenv.config();

const fastify = Fastify({
  logger: {
    level: "error",
  },
});

/**
 * Leitet Anfragen an den Scrobbler weiter und entfernt ggf. unerwünschte Felder,
 * wenn OVERRIDE_MB gesetzt ist.
 */
async function doScrobbler(req, res) {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const body = req.body?.toString();
  let status = 200;

  // Filtere Header (entferne "host" und "connection")
  const nh = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") {
      nh[key] = value;
    }
  });

  const url = `${u.pathname}${u.search}`;
  let data;
  try {
    data = await fetch(`${scrobblerApiUrl}${url}`, {
      method: method,
      body: body,
      headers: nh,
    });
    status = data.status;
  } catch (e) {
    console.error(e);
  }
  res.statusCode = status;
  res.headers = data.headers;
  let json = await data.json();

  // Entferne Felder, z. B. mbid, falls wir MusicBrainz-Overrides nutzen wollen
  if (process.env.OVERRIDE_MB === "true") {
    json = removeKeys(json, "mbid");
  }

  return { newres: res, data: json };
}

/**
 * Leitet Anfragen an die Lidarr-API weiter und ergänzt diese ggf. mit Deemix-Informationen.
 * – Sucht bei /v0.4/search nach Duplikaten (die deduplizierende Logik ist in search() implementiert).
 * – Bei /v0.4/artist/ und /v0.4/album/ werden die entsprechenden Deemix-Funktionen aufgerufen.
 */
async function doApi(req, res) {
  const headers = req.headers;
  const u = new URL(`http://localhost${req.url}`);
  const method = req.method;
  const body = req.body?.toString();
  let status = 200;

  // Erstelle ein neues Header-Objekt ohne "host" und "connection"
  const nh = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (key !== "host" && key !== "connection") {
      nh[key] = value;
    }
  });

  const url = `${u.pathname}${u.search}`;
  let data;
  try {
    data = await fetch(`${lidarrApiUrl}${url}`, {
      method: method,
      body: body,
      headers: nh,
    });
    status = data.status;
  } catch (e) {
    console.error(e);
  }

  let lidarr;
  try {
    lidarr = await data.json();
  } catch (e) {
    console.error(e);
  }

  // Bei Suchanfragen wird unser deduplizierter Such-Workflow genutzt.
  if (url.includes("/v0.4/search")) {
    // u.searchParams.get("query") liefert den Suchbegriff, "type=all" entscheidet ggf. über den manuellen Import
    lidarr = await search(
      lidarr,
      u.searchParams.get("query"),
      url.includes("type=all")
    );
  }

  // Künstlerabfrage: Falls der URL-Pfad den Deemix-Künstler anfordert
  if (url.includes("/v0.4/artist/")) {
    if (url.includes("-aaaa-")) {
      // Bei speziellen IDs (mit -aaaa-) holen wir direkt den Deemix-Künstler
      let id = url.split("/").pop()?.split("-").pop()?.replaceAll("a", "");
      lidarr = await deemixArtist(id);
      status = lidarr === null ? 404 : 200;
    } else {
      // Ansonsten ergänzen wir den Lidarr-Datensatz mit Deemix-Daten (und Duplikatsprüfung)
      lidarr = await getArtist(lidarr);
      if (process.env.OVERRIDE_MB === "true") {
        // Falls wir MusicBrainz überschreiben, geben wir keinen weiteren Abruf
        status = 404;
        lidarr = {};
      }
    }
  }

  // Albumabfrage: Bei speziellen Album-IDs (mit -bbbb-) holen wir den Deemix-Albumdatensatz
  if (url.includes("/v0.4/album/")) {
    if (url.includes("-bbbb-")) {
      let id = url.split("/").pop()?.split("-").pop()?.replaceAll("b", "");
      lidarr = await getAlbum(id);
      status = lidarr === null ? 404 : 200;
    }
  }

  // Entferne den Content-Encoding-Header (damit keine Probleme mit der Weitergabe entstehen)
  data.headers.delete("content-encoding");
  console.log(status, method, url);
  res.statusCode = status;
  res.headers = data.headers;
  return { newres: res, data: lidarr };
}

fastify.get("*", async (req, res) => {
  const headers = req.headers;
  const host = headers["x-proxy-host"];
  if (host === "ws.audioscrobbler.com") {
    const { newres, data } = await doScrobbler(req, res);
    res = newres;
    return data;
  }
  const { newres, data } = await doApi(req, res);
  res = newres;
  return data;
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  console.log("Lidarr++Deemix running at " + address);
  if (process.env.OVERRIDE_MB === "true") {
    console.log("Overriding MusicBrainz API with Deemix API");
  }
});
