import dotenv from 'dotenv'
import Fastify from 'fastify'
import * as deemix from './deemix'
import * as lidarr from './lidarr'

dotenv.config()
const app = Fastify({ logger: true })

// Merge-Helper: dedupe by artist name (case-insensitive)
function mergeArtists(a: any[] = [], b: any[] = []) {
  const names = new Set<string>()
  const merged = []
  for (const entry of [...a, ...b]) {
    const normName = (entry.name || '').toLowerCase().trim()
    if (normName && !names.has(normName)) {
      names.add(normName)
      merged.push(entry)
    }
  }
  return merged
}

// Unified search: always merge Deezer + Lidarr (Musicbrainz), fallback to Deezer only
app.get('/api/v0.4/search', async (req, reply) => {
  const { query = '', limit = '100', offset = '0' } = req.query as any

  let lidarrArtists: any[] = []
  let deemixArtists: any[] = []
  let lidarrOk = false

  try {
    lidarrArtists = await lidarr.searchLidarr(query, limit, offset)
    lidarrOk = Array.isArray(lidarrArtists) && lidarrArtists.length > 0
  } catch (err) {
    app.log.warn('Lidarr/Musicbrainz not available: ' + (err as Error).message)
  }
  try {
    deemixArtists = await deemix.searchDeemix(query, limit, offset)
  } catch (err) {
    app.log.warn('Deemix/Deezer not available: ' + (err as Error).message)
  }

  let result: any[]
  if (lidarrOk) {
    result = mergeArtists(lidarrArtists, deemixArtists)
  } else {
    result = mergeArtists([], deemixArtists)
  }
  reply.send(result)
})

// Add artist (Deezer OR Lidarr)
app.post('/api/v0.4/artist', async (req, reply) => {
  const { source, id } = req.body as any
  if (!source || !id) return reply.code(400).send({ error: 'source and id required' })

  if (source === 'deezer') {
    // Deezer-Artist hinzufügen (fix!)
    try {
      const added = await deemix.addDeezerArtist(id)
      reply.send({ ok: true, added })
    } catch (err) {
      reply.code(500).send({ error: (err as Error).message })
    }
  } else if (source === 'lidarr') {
    try {
      const added = await lidarr.addLidarrArtist(id)
      reply.send({ ok: true, added })
    } catch (err) {
      reply.code(500).send({ error: (err as Error).message })
    }
  } else {
    reply.code(400).send({ error: 'Unknown source' })
  }
})

// Get artist by ID (tries Lidarr first, then Deezer)
app.get('/api/v0.4/artist/:id', async (req, reply) => {
  const { id } = req.params as any
  try {
    return await lidarr.getArtistLidarr(id)
  } catch {
    return await deemix.getArtistDeemix(id)
  }
})

const PORT = parseInt(process.env.PORT as string) || 8080
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`Listening on ${PORT}`)
})
