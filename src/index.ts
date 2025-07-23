import express from 'express';
import axios from 'axios';
import { searchMusicbrainz } from './lidarr';
import { searchDeemix }       from './deemix';
import { mergeArtists }       from './helpers';

const app = express();

const LIDARR_BASE = process.env.LIDARR_API_BASE  || 'https://api.lidarr.audio/api/v0.4';
const DEEMIX_BASE = process.env.DEEMIX_API_BASE  || 'http://127.0.0.1:7272';

app.get('/api/v0.4/search', async (req, res) => {
  const q      = (req.query.query as string) || '';
  const offs   = parseInt(req.query.offset as string) || undefined;
  const lim    = parseInt(req.query.limit  as string) || undefined;

  if (!q) return res.status(400).json({ error: 'query ist erforderlich' });

  let mb: { name: string }[] = [];
  try {
    mb = await searchMusicbrainz(q, offs, lim);
  } catch {
    console.warn('MusicBrainz offline → nur Deezer');
  }

  let dz: { name: string }[] = [];
  try {
    dz = await searchDeemix(q, offs, lim);
  } catch {
    console.warn('Deezer/Deemix offline oder Fehler');
  }

  const merged = mergeArtists(mb, dz);
  res.json(merged);
});

app.get('/api/v0.4/artist/:id', async (req, res) => {
  const { id } = req.params;
  // 1) Offiziell
  try {
    const off = await axios.get(`${LIDARR_BASE}/artist/${id}`, { timeout: 5000 });
    if (off.status === 200 && off.data && typeof off.data === 'object') {
      return res.json(off.data);
    }
  } catch {
    console.warn(`Lidarr Artist/${id} failed, fallback → Deezer`);
  }
  // 2) Deezer
  try {
    const dz = await axios.get(`${DEEMIX_BASE}/artists/${id}`, { timeout: 5000 });
    return res.json(dz.data);
  } catch {
    return res.status(502).json({ error: 'Artist nicht verfügbar' });
  }
});

app.get('/api/v0.4/album/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const off = await axios.get(`${LIDARR_BASE}/album/${id}`, { timeout: 5000 });
    if (off.status === 200 && off.data && typeof off.data === 'object') {
      return res.json(off.data);
    }
  } catch {
    console.warn(`Lidarr Album/${id} failed, fallback → Deezer`);
  }
  try {
    const dz = await axios.get(`${DEEMIX_BASE}/albums/${id}`, { timeout: 5000 });
    return res.json(dz.data);
  } catch {
    return res.status(502).json({ error: 'Album nicht verfügbar' });
  }
});

const port = parseInt(process.env.PORT as string) || 8080;
app.listen(port, () => {
  console.log(`Lidarr++Deemix Proxy auf Port ${port}`);
});
