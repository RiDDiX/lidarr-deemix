import { FastifyRequest, FastifyReply } from 'fastify';
import { searchDeezerArtist } from './deemix.js';

export async function handleLidarrRequest(
  request: FastifyRequest<{ Params: { artist: string } }>,
  reply: FastifyReply
) {
  try {
    const results = await searchDeezerArtist(request.params.artist);
    reply.send(results);
  } catch (e) {
    reply.status(500).send({ error: 'Failed to query Deezer' });
  }
}
