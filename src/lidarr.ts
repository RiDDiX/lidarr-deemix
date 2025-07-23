import { fetchWithTimeout, buildQuery } from './helpers'

const BASE = 'https://api.lidarr.audio/api/v0.4'

export async function searchLidarr(
  query: string,
  limit = '100',
  offset = '0'
): Promise<any> {
  const qs = buildQuery({ type: 'all', query, limit, offset })
  const res = await fetchWithTimeout(`${BASE}/search?${qs}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  })
  if (!res.ok) throw new Error(`Lidarr search ${res.status}`)
  return res.json()
}

export async function getArtistLidarr(artistId: string): Promise<any> {
  const res = await fetchWithTimeout(`${BASE}/artist/${artistId}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  })
  if (!res.ok) throw new Error(`Lidarr getArtist ${res.status}`)
  return res.json()
}
