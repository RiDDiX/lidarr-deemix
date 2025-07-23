// src/lidarr.ts
import fetch from 'node-fetch';

export async function searchMusicbrainz(
  query: string,
  offset?: number,
  limit?: number
): Promise<{ name: string }[]> {
  const url = new URL('https://api.lidarr.audio/api/v0.4/search');
  url.searchParams.set('type', 'artist');
  url.searchParams.set('query', query);
  if (offset != null) url.searchParams.set('offset', offset.toString());
  if (limit  != null) url.searchParams.set('limit',  limit.toString());

  const res = await fetch(url.toString(), { timeout: 5000 });
  if (!res.ok) return [];
  const data = await res.json();
  return data.artists || [];
}
