import Fastify from 'fastify';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { search, getArtist, getAlbum } from './deemix.js';
import { getAllLidarrArtists } from './lidarr.js';

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
  logLevel: 'info',
  onError: (err: Error, req: any, res: any) => {
    fastify.log.error('Proxy error:', err.message);
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
                fastify.log.warn('Failed to parse upstream response:', parseError.message);
                data = [];
              }
            }
            
            // Always add Deemix results
            try {
              const deemixResults = await search(data, searchTerm, true);
              data = deemixResults;
              fastify.log.info(`Enhanced search results with Deemix data: ${data.length} total results`);
            } catch (deemixError) {
              fastify.log.error('Deemix search failed:', deemixError.message);
            }
            
            // Send response
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(data));
          } catch (error) {
            fastify.log.error('Error processing search response:', error.message);
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
      const artistId = artistMatch[1];
      fastify.log.info(`Artist info request for ID: ${artistId}`);
      
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
              fastify.log.warn('Failed to parse upstream artist response:', parseError.message);
            }
          }
          
          // If no upstream data or fake ID, use Deemix
          if (!artistData || artistId.startsWith('aaaaaaaa-aaaa-aaaa-aaaa-aaaaa')) {
            try {
              // Get artist from Deemix
              const deemixArtist = await getArtist({ artistname: 'Unknown', Albums: [], images: [] });
              if (deemixArtist && deemixArtist.artistname !== 'Unknown') {
                artistData = deemixArtist;
                fastify.log.info(`Provided Deemix artist data for: ${artistData.artistname}`);
              }
            } catch (deemixError) {
              fastify.log.error('Deemix artist fetch failed:', deemixError.message);
            }
          }
          
          // Enhance with Deemix data if we have upstream data
          if (artistData && artistData.artistname && !artistId.startsWith('aaaaaaaa-aaaa-aaaa-aaaa-aaaaa')) {
            try {
              artistData = await getArtist(artistData);
              fastify.log.info(`Enhanced artist data with Deemix: ${artistData.artistname}`);
            } catch (deemixError) {
              fastify.log.error('Deemix artist enhancement failed:', deemixError.message);
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
        } catch (error) {
          fastify.log.error('Error processing artist response:', error.message);
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
      const albumId = albumMatch[1];
      fastify.log.info(`Album info request for ID: ${albumId}`);
      
      if (albumId.startsWith('bbbbbbbb-bbbb-bbbb-bbbb-bbbbb')) {
        // This is a Deemix fake album ID
        try {
          const realId = albumId.substring(albumId.length - 12).replace(/^b+/, '');
          const albumData = await getAlbum(realId);
          
          if (albumData) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(albumData));
            return;
          }
        } catch (deemixError) {
          fastify.log.error('Deemix album fetch failed:', deemixError.message);
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

// Apply proxy to all routes
fastify.register((fastify, opts, done) => {
  fastify.all('*', async (request, reply) => {
    return new Promise((resolve, reject) => {
      proxy(request.raw, reply.raw, (err: any) => {
        if (err) {
          fastify.log.error('Proxy middleware error:', err.message);
          if (!reply.sent) {
            reply.code(502).send({ error: 'Proxy error', message: err.message });
          }
        }
        resolve(undefined);
      });
    });
  });
  done();
});

// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  fastify.log.error('Server error:', error.message);
  
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
    fastify.log.error('Failed to start server:', err);
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
  fastify.log.fatal('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  fastify.log.fatal('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

start();