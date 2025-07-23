import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { searchMusicbrainz } from './lidarr.js';
import { searchDeemix, Artist } from './deemix.js';
import { mergeArtists } from './helpers.js';

const app = Fastify();

app.get('/api/v0.4/search', async (req: FastifyRequest, reply: FastifyReply) => {
  const q    = (req.query as any).query as string;
  const offs = parseInt((req.query as any).offset) || undefined;
  const lim  = parseInt((req.query as any).limit)  || undefined;
  if (!q) return reply.status(400).send({ error: 'query ist erforderlich' });

  const mb = await searchMusicbrainz(q, offs, lim);
  const dz = await searchDeemix(q, offs, lim);
  return reply.send(mergeArtists(mb, dz));
});

app.get('/api/v0.4/artist/:id', async (req, reply) => {
  const id = encodeURIComponent((req.params as any).id as string);
  // Lidarr API
  try {
    const res = await fetch(`https://api.lidarr.audio/api/v0.4/artist/${id}`,{ timeout:5000 });
    if (res.ok) return reply.send(await res.json());
  } catch {}
  // Fallback Deemix
  try {
    const res = await fetch(`http://127.0.0.1:7272/artists/${id}`,{ timeout:5000 });
    if (res.ok) return reply.send(await res.json());
  } catch {}
  return reply.status(502).send({ error: 'Artist nicht verfügbar' });
});

app.get('/api/v0.4/album/:id', async (req, reply) => {
  const id = encodeURIComponent((req.params as any).id as string);
  try {
    const res = await fetch(`https://api.lidarr.audio/api/v0.4/album/${id}`,{ timeout:5000 });
    if (res.ok) return reply.send(await res.json());
  } catch {}
  try {
    const res = await fetch(`http://127.0.0.1:7272/albums/${id}`,{ timeout:5000 });
    if (res.ok) return reply.send(await res.json());
  } catch {}
  return reply.status(502).send({ error: 'Album nicht verfügbar' });
});

app.listen({ port: 8080 }, err => { if(err) throw err; console.log('Proxy on 8080'); });
