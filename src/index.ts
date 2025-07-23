import Fastify from 'fastify'
import dotenv from 'dotenv'
import * as lidarr from './lidarr.js'
import * as deemix from './deemix.js'

dotenv.config()
const server = Fastify({ logger: true })

// Gemeinsame Suche
server.get('/api/v0.4/search', async (req, reply) => {
  const { query = '', limit = '100', offset = '0' } = (req.query as any)

  // 1) Offizielle Lidarr‑API
  let lidarrRes = null
  try {
    lidarrRes = await lidarr.searchLidarr(query, limit, offset)
  } catch (err) {
    server.log.warn(`Lidarr failed: ${(err as Error).message}`)
  }

  // 2) Deezer/Deemix immer zusätzlich
  let deemixRes = null
  try {
    deemixRes = await deemix.searchDeemix(query, limit, offset)
  } catch (err) {
    server.log.warn(`Deemix failed: ${(err as Error).message}`)
  }

  return { lidarr: lidarrRes, deemix: deemixRes }
})

// Einzel‑Artist: Lidarr, sonst Deemix
server.get('/api/v0.4/artist/:id', async (req, reply) => {
  const id = (req.params as any).id
  try {
    return await lidarr.getArtistLidarr(id)
  } catch {
    return await deemix.getArtistDeemix(id)
  }
})

const PORT = parseInt(process.env.PORT as string, 10) || 7171
await server.listen({ port: PORT, host: '0.0.0.0' })
server.log.info(`Listening on ${PORT}`)
