import Fastify from 'fastify';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  search,
  getArtist,
  getAlbum,
  deemixArtist,
  decodeFakeId,
  isFakeId,
} from './deemix.js';

const fastify = Fastify({
  logger: {
    level: 'info',
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

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Proxy configuration
const proxyOptions = {
  target: 'https://api.lidarr.audio',
  changeOrigin: true,
  secure: true,
  followRedirects: true,
  timeout: 30000,
  proxyTimeout: 30000,
  logLevel: 'info' as 'info',
  onError: (err: Error, req: any, res: any) => {
    fastify.log.error({ err }, 'Proxy error');
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    }
  },
  onProxyReq: (proxyReq: any, req: any, res: any) => {
    fastify.log.info(`Proxying request: ${req.method} ${req.url}`);
  },
  onProxyRes: async (proxyRes: any, req: any, res: any) => {
    let body = '';
    
    // Handle search requests
    if (req.url && req.url.includes('/search')) {
      const searchMatch = req.url.match(/[?&]term=([^&]+)/);
      if (searchMatch) {
        const searchTerm = decodeURIComponent(searchMatch[1]);
        fastify.log.info(`Search request for: ${searchTerm}`);
        
        proxyRes.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        
        proxyRes.on('end', async () => {
          try {
            let data = [];
            
            // Try to parse upstream response
            if (body.trim()) {
              try {
                data = JSON.parse(body);
                if (!Array.isArray(data)) {
                  data = [];
                }
              } catch (parseError) {
            fastify.log.warn({ err: parseError }, 'Failed to parse upstream response');
                data = [];
              }
            }
            
            // Always add Deemix results
            try {
              const deemixResults = await search(data, searchTerm, true);
              data = deemixResults;
              fastify.log.info(`Enhanced search results with Deemix data: ${data.length} total results`);
            } catch (deemixError) {
              fastify.log.error({ err: deemixError }, 'Deemix search failed');
            }
            
            // Send response
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(data));
          } catch (error) {
            fastify.log.error({ err: error }, 'Error processing search response');
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify([]));
          }
        });
        
        return; // Don't send the original response
      }
    }
    
    // Handle artist info requests
    const artistMatch = req.url && req.url.match(/\/artists?\/([^/?]+)/);
    if (artistMatch) {
      const artistId = decodeURIComponent(artistMatch[1]);
      fastify.log.info(`Artist info request for ID: ${artistId}`);

      if (isFakeId(artistId, 'artist')) {
        const realId = decodeFakeId(artistId, 'artist');
        if (!realId) {
          fastify.log.error(`Unable to decode Deemix artist ID for ${artistId}`);
          res.writeHead(404, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ error: 'Artist not found' }));
          return;
        }

        try {
          const deemixData = await deemixArtist(realId);
          if (deemixData) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(deemixData));
            return;
          }
        } catch (deemixError: any) {
          fastify.log.error({ err: deemixError }, 'Deemix artist fetch failed');
        }

        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'Artist not found' }));
        return;
      }
      
      proxyRes.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      
      proxyRes.on('end', async () => {
        try {
          let artistData = null;
          
          // Try to parse upstream response
          if (body.trim()) {
            try {
              artistData = JSON.parse(body);
            } catch (parseError) {
              fastify.log.warn({ err: parseError }, 'Failed to parse upstream artist response');
            }
          }
          
          // If no upstream data or fake ID, use Deemix
          // Enhance with Deemix data if we have upstream data
          if (artistData && artistData.artistname) {
            try {
              artistData = await getArtist(artistData);
              fastify.log.info(`Enhanced artist data with Deemix: ${artistData.artistname}`);
            } catch (deemixError) {
              fastify.log.error({ err: deemixError }, 'Deemix artist enhancement failed');
            }
          }
          
          // Send response
          if (artistData) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(artistData));
          } else {
            res.writeHead(404, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Artist not found' }));
          }
        } catch (error: any) {
          fastify.log.error({ err: error }, 'Error processing artist response');
          res.writeHead(500, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
      
      return; // Don't send the original response
    }
    
    // Handle album info requests  
    const albumMatch = req.url && req.url.match(/\/albums?\/([^/?]+)/);
    if (albumMatch) {
      const albumId = decodeURIComponent(albumMatch[1]);
      fastify.log.info(`Album info request for ID: ${albumId}`);

      if (isFakeId(albumId, 'album')) {
        try {
          const realId = decodeFakeId(albumId, 'album');
          const albumData = await getAlbum(realId);

          if (albumData) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(albumData));
            return;
          }
        } catch (deemixError: any) {
          fastify.log.error({ err: deemixError }, 'Deemix album fetch failed');
        }
        
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ error: 'Album not found' }));
        return;
      }
    }
    
    // For all other requests, pass through normally
    // Don't modify the response, just let it pass through
  }
};

// Create proxy middleware
const proxy = createProxyMiddleware(proxyOptions);
const proxyHandler = proxy as unknown as (
  req: any,
  res: any,
  next: (err?: any) => void
) => void;

// Apply proxy to all routes
fastify.register((fastify, opts, done) => {
  fastify.all('*', (request, reply) => {
    return new Promise<void>((resolve, reject) => {
      proxyHandler(request.raw, reply.raw, (err?: any) => {
        if (err) {
          fastify.log.error({ err }, 'Proxy middleware error');
          if (!reply.sent) {
            const message = typeof err?.message === 'string' ? err.message : 'Proxy error';
            reply.code(502).send({ error: 'Proxy error', message });
          }
        }
        resolve();
      });
    });
  });
  done();
});

// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  fastify.log.error({ err: error }, 'Server error');
  
  if (!reply.sent) {
    reply.code(500).send({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
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