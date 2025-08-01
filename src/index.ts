import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { searchDeemixArtists, getDeemixArtistById, fakeId } from "./deemix.js";
import { getArtistData } from "./artistData.js"; // Deine Funktion für MusicBrainz
import { normalize } from "./helpers.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const fastify = Fastify({ logger: false });

fastify.setErrorHandler((error, request, reply) => {
  console.error("Unerwarteter Fehler:", error);
  if (!reply.sent) {
    reply.status(500).send({ error: "Internal Server Error" });
  }
});

async function doApi(req: FastifyRequest, res: FastifyReply) {
    const u = new URL(`http://localhost${req.url}`);
    const url = `${u.pathname}${u.search}`;
    let finalResult: any = null;

    const nh: { [key: string]: any } = {};
    Object.entries(req.headers).forEach(([key, value]) => {
        if (!['host', 'connection'].includes(key.toLowerCase())) nh[key] = value;
    });

    // Anfrage für einen bestimmten Künstler
    if (url.includes("/v0.4/artist/")) {
        const artistId = u.pathname.split('/').pop() || '';
        if (artistId.startsWith('aaaaaaaa')) { // Deemix ID
            finalResult = await getDeemixArtistById(artistId);
        } else { // MusicBrainz ID
            finalResult = await getArtistData(artistId);
        }
    }
    // Allgemeine Suchanfrage - hier findet die Geschwindigkeits-Magie statt
    else if (url.includes("/v0.4/search")) {
        const queryParam = u.searchParams.get("query") || "";
        console.log(`Starte parallele Suche für: "${queryParam}"`);

        // Promise für die Abfrage an api.lidarr.audio (MusicBrainz) mit kurzem Timeout
        const lidarrPromise = fetch(`${lidarrApiUrl}${url}`, { headers: nh, timeout: 3000 })
            .then(response => response.ok ? response.json() : [])
            .then(data => (Array.isArray(data) ? data : []))
            .catch(() => {
                console.warn("Lidarr API (MusicBrainz) nicht erreichbar oder Timeout. Wird ignoriert.");
                return []; // Wichtig: Bei Fehler ein leeres Array zurückgeben
            });

        // Promise für die Abfrage an unseren Deemix-Server
        const deemixPromise = searchDeemixArtists(queryParam);

        // Auf die Ergebnisse beider Suchen gleichzeitig warten
        const [lidarrResults, deemixArtists] = await Promise.all([lidarrPromise, deemixPromise]);

        console.log(`Suche beendet: ${lidarrResults.length} von MusicBrainz, ${deemixArtists.length} von Deemix.`);

        // Ergebnisse zusammenführen und Duplikate vermeiden
        const existingLidarrNames = new Set(lidarrResults.map(item => normalize(item?.artist?.artistname || '')));
        const deemixFormattedResults = [];

        for (const d of deemixArtists) {
            if (!existingLidarrNames.has(normalize(d.name))) {
                deemixFormattedResults.push({
                    artist: {
                        id: fakeId(d.id, "artist"),
                        foreignArtistId: fakeId(d.id, "artist"),
                        artistname: d.name,
                        sortname: d.name,
                        images: [{ CoverType: "Poster", Url: d.picture_xl }],
                        disambiguation: `Deemix ID: ${d.id}`,
                        overview: `Von Deemix importierter Künstler. ID: ${d.id}`,
                        artistaliases: [], genres: [], status: "active", type: "Artist"
                    },
                });
            }
        }
        finalResult = [...lidarrResults, ...deemixFormattedResults];
    }
    // Alle anderen Anfragen einfach durchleiten
    else {
         try {
            const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { headers: nh, timeout: 3000 });
            if (upstreamResponse.ok) finalResult = await upstreamResponse.json();
         } catch (e) {
             console.warn(`Generische Anfrage an ${url} fehlgeschlagen.`);
         }
    }

    // Finale Antwort senden
    if (finalResult === null || (Array.isArray(finalResult) && finalResult.length === 0)) {
        res.status(404).send({});
    } else {
        res.status(200).send(finalResult);
    }
}

// Alle Anfragen an unsere Hauptlogik weiterleiten
fastify.all('*', (req, res) => {
    doApi(req, res);
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`✅ Lidarr++Deemix Proxy läuft jetzt stabil und schnell unter ${address}`);
});