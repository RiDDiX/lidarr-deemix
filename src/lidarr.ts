import fetch from 'node-fetch';
import { Artist } from './deemix.js';

const BASE = process.env.LIDARR_API_BASE || 'https://api.lidarr.audio/api/v0.4';

export async function searchMusicbrainz(
  query: string,
  offset?: number,
  limit?: number
): Promise<Artist[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set('type', 'artist');
  url.searchParams.set('query', query);
  if (offset != null) url.searchParams.set('offset', offset.toString());
  if (limit  != null) url.searchParams.set('limit',  limit.toString());

  try {
    const res = await fetch(url.toString(), { timeout: 5000 });
    if (!res.ok) return [];
    const data = await res.json();
    return data.artists || [];
  } catch {
    return [];
  }
}