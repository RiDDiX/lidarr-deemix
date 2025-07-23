import fetch from 'node-fetch'
import { cleanArtist } from './helpers'

const DEEMIX_URL = process.env.DEEMIX_URL || 'http://localhost:6595'

// Suche Deezer/Deemix-Artists
export async function searchDeemix(query: string, limit: string | number = 100, offset: string | number = 0) {
  const url = `${DEEMIX_URL}/search/artists?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Deemix search ' + res.status)
  const json = await res.json()
  return (json.data || []).map(cleanArtist)
}

// Holt einen einzelnen Deezer/Deemix-Artist
export async function getArtistDeemix(id: string) {
  const url = `${DEEMIX_URL}/artist/${id}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Deemix artist ' + res.status)
  const json = await res.json()
  return cleanArtist(json)
}

// Deezer-Artist zu Favoriten/Hinzufügen (hier ggf. POST oder passendes API-Call anpassen)
export async function addDeezerArtist(id: string) {
  const url = `${DEEMIX_URL}/favorite/artists/${id}`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error('Deemix add artist ' + res.status)
  return await res.json()
}
