import fetch from "node-fetch";
import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import { search, getDeemixArtistById, getAlbumById } from "./deemix.js";
import { getArtistData } from "./artistData.js";

dotenv.config();

const lidarrApiUrl = "https://api.lidarr.audio";
const fastify = Fastify({ logger: false });

// Zentraler Fehler-Handler, um unerwartete Abstürze zu verhindern
fastify.setErrorHandler((error, request, reply) => {
  console.error("Ein unerwarteter Fehler wurde im zentralen Handler abgefangen:", error);
  if (!reply.sent) {
    reply.status(500).send({ error: "Internal Server Error", message: error.message });
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

    // --- FINALE LOGIK ZUR VERMEIDUNG VON TIMEOUTS ---

    // 1. Spezifische Anfragen (Künstler oder Album per ID)
    if (url.includes("/v0.4/artist/")) {
        const artistId = u.pathname.split('/').pop() || '';
        if (artistId.startsWith('aaaaaaaa')) {
            console.log(`Verarbeite Deemix-Künstler-Anfrage für Fake-ID ${artistId}`);
            finalResult = await getDeemixArtistById(artistId);
        } else {
            console.log(`Versuche, MusicBrainz-Künstler für MBID ${artistId} abzurufen...`);
            finalResult = await getArtistData(artistId);
        }
    } else if (url.includes("/v0.4/album/")) {
        const albumId = u.pathname.split('/').pop() || '';
        if (albumId.startsWith('bbbbbbbb')) {
             console.log(`Verarbeite Deemix-Album-Anfrage für Fake-ID ${albumId}`);
             finalResult = await getAlbumById(albumId);
        } else {
            // Album-Anfragen an MusicBrainz leiten wir durch, aber mit kurzem Timeout
            try {
                 const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { headers: nh, timeout: 2000 }); // 2-Sekunden-Timeout
                 if (upstreamResponse.ok) finalResult = await upstreamResponse.json();
            } catch (e) {
                console.warn(`Timeout oder Fehler bei der Abfrage von Album ${albumId} von Lidarr API.`);
            }
        }
    }
    // 2. Allgemeine Suchanfragen
    else if (url.includes("/v0.4/search")) {
        let lidarrResults: any[] = [];
        try {
            // **ENTSCHEIDENDER FIX: Kurzer Timeout von 2 Sekunden**
            // Wenn die Lidarr-API nicht schnell antwortet, brechen wir ab und nutzen nur Deemix.
            const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { headers: nh, timeout: 2000 });
            
            if (upstreamResponse.ok) {
                const parsed = await upstreamResponse.json();
                lidarrResults = Array.isArray(parsed) ? parsed : [];
                console.log(`${lidarrResults.length} Ergebnisse von MusicBrainz erhalten.`);
            } else {
                 console.warn(`Lidarr API (MusicBrainz) antwortete mit Status ${upstreamResponse.status}.`);
            }
        } catch (e) {
            console.warn("Lidarr API (MusicBrainz) nicht erreichbar oder Timeout. Fahre nur mit Deemix fort.");
            // Dieser Fehler ist erwartet, wenn die API langsam ist. lidarrResults bleibt leer.
        }
        
        const queryParam = u.searchParams.get("query") || "";
        console.log(`Führe Deemix-Suche für "${queryParam}" aus...`);
        finalResult = await search(lidarrResults, queryParam);
    }
    // 3. Alle anderen Anfragen durchleiten (z.B. für Systemstatus etc.)
    else {
         try {
            const upstreamResponse = await fetch(`${lidarrApiUrl}${url}`, { headers: nh, timeout: 2000 });
            if (upstreamResponse.ok) finalResult = await upstreamResponse.json();
         } catch (e) {
             console.warn(`Generische Anfrage an ${url} fehlgeschlagen oder Timeout.`);
         }
    }

    // Finale Status-Prüfung
    if (finalResult === null || (Array.isArray(finalResult) && finalResult.length === 0)) {
        console.log(`Keine Ergebnisse für ${url} gefunden. Sende 404, um die Anfrage in Lidarr abzuschließen.`);
        res.status(404).send({});
    } else {
        console.log(`Sende erfolgreiche Antwort (200) für ${url} mit ${Array.isArray(finalResult) ? finalResult.length : '1'} Ergebnissen.`);
        res.status(200).send(finalResult);
    }
}

// Haupt-Routing
fastify.all('*', (req, res) => {
    doApi(req, res);
});

fastify.listen({ port: 7171, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`✅ Lidarr++Deemix Proxy läuft jetzt stabil unter ${address}`);
});