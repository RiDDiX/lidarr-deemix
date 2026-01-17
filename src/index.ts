import Fastify from 'fastify';
import {
  search,
  getArtist,
  getAlbum,
  deemixArtist,
  decodeFakeId,
  isFakeId,
} from './deemix.js';

const LIDARR_API_URL = 'https://api.lidarr.audio';
const API_VERSION = 'v0.4';
const FETCH_TIMEOUT = 30000;

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  }
});

async function fetchFromLidarr(path: string): Promise<any> {
  const url = `${LIDARR_API_URL}${path}`;
  fastify.log.debug(`Fetching from Lidarr: ${url}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'LidarrDeemixProxy/2.0',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Lidarr API error: ${response.status}`);
    }
    
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Search endpoint - /api/v0.4/search
fastify.get('/api/:version/search', async (request, reply) => {
  const { version } = request.params as { version: string };
  const { type, query, term } = request.query as { type?: string; query?: string; term?: string };
  const searchTerm = query || term || '';
  const searchType = type || 'all';
  
  fastify.log.info(`Search request: term="${searchTerm}" type="${searchType}"`);
  
  try {
    // Fetch from Lidarr API
    let lidarrData: any[] = [];
    try {
      // Note: URLSearchParams encodes spaces as '+', but Lidarr API expects '%20'
      const encodedQuery = encodeURIComponent(searchTerm);
      const data = await fetchFromLidarr(`/api/${version}/search?type=${searchType}&query=${encodedQuery}`);
      if (Array.isArray(data)) {
        lidarrData = data;
      }
    } catch (error) {
      fastify.log.warn({ err: error }, 'Failed to fetch from Lidarr API, using Deemix only');
    }
    
    // Log Lidarr data before enhancement
    fastify.log.info(`Lidarr data received: ${lidarrData.length} results`);
    
    // Enhance with Deemix results (if Deemix is available)
    let enhancedResults: any[];
    try {
      enhancedResults = await search(lidarrData, searchTerm, true);
    } catch (searchError) {
      fastify.log.warn({ err: searchError }, 'Deemix enhancement failed, returning Lidarr data only');
      enhancedResults = lidarrData;
    }
    
    fastify.log.info(`Search results: ${lidarrData.length} from Lidarr, ${enhancedResults.length} total after enhancement`);
    
    return enhancedResults;
  } catch (error) {
    fastify.log.error({ err: error }, 'Search failed completely');
    return [];
  }
});

// Artist endpoint - /api/v0.4/artist/{id}
fastify.get('/api/:version/artist/:artistId', async (request, reply) => {
  const { version, artistId } = request.params as { version: string; artistId: string };
  
  fastify.log.info(`Artist request: ${artistId}`);
  
  // Check if this is a Deemix fake ID
  if (isFakeId(artistId, 'artist')) {
    const realId = decodeFakeId(artistId, 'artist');
    if (!realId) {
      reply.code(404);
      return { error: 'Artist not found' };
    }
    
    try {
      const artistData = await deemixArtist(realId);
      if (artistData) {
        return artistData;
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Deemix artist fetch failed');
    }
    
    reply.code(404);
    return { error: 'Artist not found' };
  }
  
  // Fetch from Lidarr and enhance with Deemix
  try {
    let artistData = await fetchFromLidarr(`/api/${version}/artist/${artistId}`);
    
    if (!artistData) {
      reply.code(404);
      return { error: 'Artist not found' };
    }
    
    // Enhance with Deemix data
    if (artistData.artistname) {
      artistData = await getArtist(artistData);
      fastify.log.info(`Enhanced artist: ${artistData.artistname}`);
    }
    
    return artistData;
  } catch (error) {
    fastify.log.error({ err: error }, 'Artist fetch failed');
    reply.code(500);
    return { error: 'Internal server error' };
  }
});

// Album endpoint - /api/v0.4/album/{id}
fastify.get('/api/:version/album/:albumId', async (request, reply) => {
  const { version, albumId } = request.params as { version: string; albumId: string };
  
  fastify.log.info(`Album request: ${albumId}`);
  
  // Check if this is a Deemix fake ID
  if (isFakeId(albumId, 'album')) {
    const realId = decodeFakeId(albumId, 'album');
    if (!realId) {
      reply.code(404);
      return { error: 'Album not found' };
    }
    
    try {
      const albumData = await getAlbum(realId);
      if (albumData) {
        return albumData;
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Deemix album fetch failed');
    }
    
    reply.code(404);
    return { error: 'Album not found' };
  }
  
  // Fetch from Lidarr
  try {
    const albumData = await fetchFromLidarr(`/api/${version}/album/${albumId}`);
    
    if (!albumData) {
      reply.code(404);
      return { error: 'Album not found' };
    }
    
    return albumData;
  } catch (error) {
    fastify.log.error({ err: error }, 'Album fetch failed');
    reply.code(500);
    return { error: 'Internal server error' };
  }
});

// Catch-all proxy for other endpoints
fastify.all('/api/*', async (request, reply) => {
  const path = request.url;
  fastify.log.info(`Proxying: ${request.method} ${path}`);
  
  try {
    const response = await fetch(`${LIDARR_API_URL}${path}`, {
      method: request.method,
      headers: {
        'User-Agent': 'LidarrDeemixProxy/2.0',
        'Accept': 'application/json',
      },
    });
    
    reply.code(response.status);
    
    const contentType = response.headers.get('content-type');
    if (contentType) {
      reply.header('Content-Type', contentType);
    }
    
    const data = await response.text();
    return reply.send(data);
  } catch (error) {
    fastify.log.error({ err: error }, 'Proxy request failed');
    reply.code(502);
    return { error: 'Bad Gateway' };
  }
});

// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  fastify.log.error({ err: error }, 'Server error');
  reply.code(500).send({ error: 'Internal server error', message: error.message });
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '8080');
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    fastify.log.info(`🚀 Lidarr-Deemix proxy server started on ${host}:${port}`);
    fastify.log.info('📡 Proxying to: https://api.lidarr.audio');
    fastify.log.info('🎵 Deemix integration enabled');
  } catch (err) {
    fastify.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  fastify.log.info('Received SIGTERM, shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  fastify.log.info('Received SIGINT, shutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  fastify.log.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  fastify.log.fatal({ promise, reason }, 'Unhandled rejection');
  process.exit(1);
});

start();