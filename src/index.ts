import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { searchMusicbrainz, getArtistFromMB, getAlbumFromMB } from './lidarr.js';
import { searchDeemix, getArtistFromDZ, getAlbumFromDZ }       from './deemix.js';
import { mergeArtists }       from './helpers.js';

const app = Fastify();

app.get('/api/v0.4/search', async (req: FastifyRequest, reply: FastifyReply) => {
  const q    = (req.query as any).query as string;
  const offs = parseInt((req.query as any).offset) || undefined;
  const lim  = parseInt((req.query as any).limit)  || undefined;
  if (!q) return reply.status(400).send({ error: 'query ist erforderlich' });

  // 1) MusicBrainz
  let mb = [];
  try {
    mb = await searchMusicbrainz(q, offs, lim);
  } catch {
    console.warn('MB offline → nur Deezer');
  }

  // 2) Deezer/Deemix
  let dz = [];
  try {
    dz = await searchDeemix(q, offs, lim);
  } catch {
    console.warn('Deemix offline');
  }

  // 3) Merge + Dedup
  const merged = mergeArtists(mb, dz);
  return reply.send(merged);
});

app.get('/api/v0.4/artist/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const id = (req.params as any).id as string;

  // 1) Versuch Lidarr/MB
  try {
    const artist = await getArtistFromMB(id);
    return reply.send(artist);
  } catch {
    console.warn(`MB artist ${id} failed → Fallback`);
  }

  // 2) Fallback Deezer
  try {
    const artist = await getArtistFromDZ(id);
    return reply.send(artist);
  } catch {
    console.error(`DZ artist ${id} failed`);
    return reply.status(502).send({ error: 'Artist nicht verfügbar' });
  }
});

app.get('/api/v0.4/album/:id', async (req: FastifyRequest, reply: FastifyReply) => {
  const id = (req.params as any).id as string;

  // 1) MB
  try {
    const album = await getAlbumFromMB(id);
    return reply.send(album);
  } catch {
    console.warn(`MB album ${id} failed → Fallback`);
  }

  // 2) DZ
  try {
    const album = await getAlbumFromDZ(id);
    return reply.send(album);
  } catch {
    console.error(`DZ album ${id} failed`);
    return reply.status(502).send({ error: 'Album nicht verfügbar' });
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen({ port }, (err) => {
  if (err) throw err;
  console.log(`Proxy läuft auf Port ${port}`);
});