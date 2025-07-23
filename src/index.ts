import Fastify from 'fastify'
import dotenv from 'dotenv'
import * as lidarr from './lidarr'
import * as deemix from './deemix'

dotenv.config()
const server = Fastify({ logger: true })

// Gemeinsamer Search-Endpunkt
server.get('/api/v0.4/search', async (req, reply) => {
  const { query = '', limit = '100', offset = '0' } = (req.query as any)

  // 1) Offizielle Lidarr-Suche
  let lidarrRes: any = null
  try {
    lidarrRes = await lidarr.searchLidarr(query, limit, offset)
  } catch (err) {
    server.log.warn(`Lidarr failed: ${(err as Error).message}`)
  }

  // 2) Immer Deezer/Deemix dazu (Fallback oder Ergänzung)
  let deemixRes: any = null
  try {
    deemixRes = await deemix.searchDeemix(query, limit, offset)
  } catch (err) {
    server.log.warn(`Deemix failed: ${(err as Error).message}`)
  }

  return { lidarr: lidarrRes, deemix: deemixRes }
})

// Beispiel: Einzel‑Artist holen
server.get('/api/v0.4/artist/:id', async (req, reply) => {
  const id = (req.params as any).id
  // Versuch Lidarr
  try {
    return await lidarr.getArtistLidarr(id)
  } catch {
    // dann Deezer
    return await deemix.getArtistDeemix(id)
  }
})

const port = Number(process.env.PORT || 3000)
server.listen({ port, host: '0.0.0.0' })
  .then(() => server.log.info(`listening on ${port}`))
