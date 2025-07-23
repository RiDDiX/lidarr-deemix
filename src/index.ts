import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fetch from 'node-fetch';
import { searchMusicbrainz } from './lidarr';
import { searchDeemix }       from './deemix';
import { mergeArtists }       from './helpers';

const app = Fastify();
const LIDARR_BASE = 'https://api.lidarr.audio/api/v0.4';
const DEEMIX_BASE = 'http://127.0.0.1:7272';

app.get('/api/v0.4/search', async (req: FastifyRequest, reply: FastifyReply) => {
  const q    = (req.query as any).query as string;
  const offs = parseInt((req.query as any).offset) || undefined;
  const lim  = parseInt((req.query as any).limit)  || undefined;
  if (!q) return reply.status(400).send({ error: 'query ist erforderlich' });

  let mb = [], dz = [];
  try { mb = await searchMusicbrainz(q, offs, lim) } catch { console.warn('MB offline') }
  try { dz = await searchDeemix(q, offs, lim)       } catch { console.warn('Deemix offline') }

  reply.send(mergeArtists(mb, dz));
});

app.get('/api/v0.4/artist/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const id = (req.params as any).id as string;
  try {
    const res = await fetch(`${LIDARR_BASE}/artist/${id}`, { timeout: 5000 });
    if (res.ok) return reply.send(await res.json());
  } catch { console.warn(`Lidarr artist/${id} failed`) }

  try {
    const res = await fetch(`${DEEMIX_BASE}/artists/${id}`, { timeout: 5000 });
    return reply.send(await res.json());
  } catch {
    return reply.status(502).send({ error: 'Artist nicht verfügbar' });
  }
});

app.get('/api/v0.4/album/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const id = (req.params as any).id as string;
  try {
    const res = await fetch(`${LIDARR_BASE}/album/${id}`, { timeout: 5000 });
    if (res.ok) return reply.send(await res.json());
  } catch { console.warn(`Lidarr album/${id} failed`) }

  try {
    const res = await fetch(`${DEEMIX_BASE}/albums/${id}`, { timeout: 5000 });
    return reply.send(await res.json());
  } catch {
    return reply.status(502).send({ error: 'Album nicht verfügbar' });
  }
});

app.listen({ port: 8080 }, (err, address) => {
  if (err) throw err;
  console.log(`Proxy läuft auf ${address}`);
});
