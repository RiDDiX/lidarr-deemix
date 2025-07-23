import express, { Request, Response } from 'express';
import axios, { AxiosResponse } from 'axios';
import { searchMusicbrainz } from './lidarr';
import { searchDeemix } from './deemix';
import { mergeArtists } from './helpers';

const app = express();
app.use(express.json());

// Basis‐URLs für die offiziellen Lidarr‐API und Euren lokalen Deezer/Deemix‐Proxy
const LIDARR_API_BASE = process.env.LIDARR_API_BASE || 'https://api.lidarr.audio/api/v0.4';
const DEEMIX_API_BASE = process.env.DEEMIX_API_BASE || 'http://127.0.0.1:7272';

/**
 * Search‐Endpoint:
 * Fragt MusicBrainz (über die offizielle Lidarr‐API) und Euren Deezer/Deemix‐Proxy parallel ab,
 * merged die Ergebnisse und entfernt Duplikate.
 */
app.get('/api/v0.4/search', async (req: Request, res: Response) => {
  const query = (req.query.query as string) || (req.query.q as string);
  const offset = Number(req.query.offset) || undefined;
  const limit  = Number(req.query.limit)  || undefined;

  if (!query) {
    return res.status(400).json({ error: 'Parameter "query" ist erforderlich' });
  }

  try {
    // 1) Offizielle Lidarr/MusicBrainz‐Suche
    const mbResults = await searchMusicbrainz(query, offset, limit);

    // 2) Deezer/Deemix‐Suche
    const dzResults = await searchDeemix(query, offset, limit);

    // 3) Arrays zusammenführen und Duplikate nach normalisiertem Namen entfernen
    const merged = mergeArtists(mbResults, dzResults);

    return res.json(merged);
  } catch (err: any) {
    console.error('Search‐Error:', err);
    return res.status(500).json({ error: 'Interner Serverfehler bei Suche' });
  }
});

/**
 * Artist‐Details mit Fallback:
 * 1) Versuch offizielle Lidarr‐API
 * 2) Wenn dort Fehler oder kein Datensatz (z.B. 404/HTML), fallback auf Deezer/Deemix
 */
app.get('/api/v0.4/artist/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  // 1) Offiziell bei Lidarr
  try {
    const official: AxiosResponse<any> = await axios.get(
      `${LIDARR_API_BASE}/artist/${encodeURIComponent(id)}`,
      { timeout: 5000 }
    );
    // Wenn valide JSON‐Antwort (kein HTML‐Error)
    if (official.status === 200 && typeof official.data === 'object') {
      return res.json(official.data);
    }
  } catch (err) {
    console.warn(`Lidarr‐API Artist/${id} failed, fallback to Deemix…`, (err as Error).message);
  }

  // 2) Fallback: Deezer/Deemix
  try {
    const fallback: AxiosResponse<any> = await axios.get(
      `${DEEMIX_API_BASE}/artists/${encodeURIComponent(id)}`,
      { timeout: 5000 }
    );
    return res.json(fallback.data);
  } catch (err) {
    console.error(`Deemix‐Fallback Artist/${id} failed too:`, (err as Error).message);
    return res.status(502).json({ error: 'Artist konnte weder offiziell noch per Deezer abgerufen werden' });
  }
});

/**
 * (Optional) Album‐Details mit Fallback, analog zu Artist
 */
app.get('/api/v0.4/album/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  // Offizielle Lidarr‐Album‐Daten
  try {
    const official: AxiosResponse<any> = await axios.get(
      `${LIDARR_API_BASE}/album/${encodeURIComponent(id)}`,
      { timeout: 5000 }
    );
    if (official.status === 200 && typeof official.data === 'object') {
      return res.json(official.data);
    }
  } catch {
    console.warn(`Lidarr‐API Album/${id} failed, fallback to Deemix…`);
  }

  // Deezer/Deemix‐Fallback
  try {
    const fallback: AxiosResponse<any> = await axios.get(
      `${DEEMIX_API_BASE}/albums/${encodeURIComponent(id)}`,
      { timeout: 5000 }
    );
    return res.json(fallback.data);
  } catch {
    console.error(`Deemix‐Fallback Album/${id} failed too`);
    return res.status(502).json({ error: 'Album konnte weder offiziell noch per Deezer abgerufen werden' });
  }
});

// Starte den Proxy‐Server
const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Lidarr++Deemix Proxy läuft auf Port ${port}`);
});
