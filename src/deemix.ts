import { fetchWithTimeout, buildQuery } from './helpers'

const BASE = process.env.DEEMIX_URL || 'http://127.0.0.1:7171'

export async function searchDeemix(
  query: string,
  limit = '100',
  offset = '0'
): Promise<any> {
  // hier liefern wir nur Artists als Beispiel
  const qs = buildQuery({ q: query, limit, offset })
  const res = await fetchWithTimeout(`${BASE}/search/artists?${qs}`, {
    method: 'GET'
  })
  if (!res.ok) throw new Error(`Deemix search ${res.status}`)
  return res.json()
}

export async function getArtistDeemix(artistId: string): Promise<any> {
  const res = await fetchWithTimeout(`${BASE}/artists/${artistId}`, {
    method: 'GET'
  })
  if (!res.ok) throw new Error(`Deemix getArtist ${res.status}`)
  return res.json()
}
