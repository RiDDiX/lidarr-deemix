import { FastifyRequest, FastifyReply } from 'fastify';
import { searchDeezerArtist } from './deemix';

export async function handleLidarrRequest(
  request: FastifyRequest<{ Params: { artist: string } }>,
  reply: FastifyReply
) {
  const artist = request.params.artist;
  try {
    const results = await searchDeezerArtist(artist);
    reply.send(results);
  } catch (err) {
    reply.code(500).send({ error: 'Failed to search Deezer', detail: err });
  }
}
