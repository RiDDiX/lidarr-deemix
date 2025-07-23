import fetch from 'node-fetch'
import { cleanArtist } from './helpers'

const LIDARR_URL = process.env.LIDARR_URL || 'http://localhost:8686'
const LIDARR_APIKEY = process.env.LIDARR_APIKEY

// Sucht Artists via Musicbrainz/Lidarr
export async function searchLidarr(query: string, limit: string | number = 100, offset: string | number = 0) {
  const url = `${LIDARR_URL}/api/v1/search?query=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { 'X-Api-Key': LIDARR_APIKEY || '' }
  })
  if (!res.ok) throw new Error('Lidarr search ' + res.status)
  const json = await res.json()
  // Mapping to artist objects as expected, ggf. anpassen je nach API Output
  return (json || []).map(cleanArtist)
}

// Holt einen einzelnen Artist von Lidarr
export async function getArtistLidarr(id: string) {
  const url = `${LIDARR_URL}/api/v1/artist/${id}`
  const res = await fetch(url, {
    headers: { 'X-Api-Key': LIDARR_APIKEY || '' }
  })
  if (!res.ok) throw new Error('Lidarr get artist ' + res.status)
  const json = await res.json()
  return cleanArtist(json)
}

// Artist zu Lidarr hinzufügen
export async function addLidarrArtist(id: string) {
  const url = `${LIDARR_URL}/api/v1/artist`
  // Typischerweise: POST mit MusicbrainzId
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Api-Key': LIDARR_APIKEY || '',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ foreignArtistId: id })
  })
  if (!res.ok) throw new Error('Lidarr add artist ' + res.status)
  return await res.json()
}
