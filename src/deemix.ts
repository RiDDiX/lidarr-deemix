import fetch from 'node-fetch';

export interface Artist { name: string; [key: string]: any }

const BASE = process.env.DEEMIX_API_BASE || 'http://127.0.0.1:7272';

export async function searchDeemix(
  query: string,
  offset?: number,
  limit?: number
): Promise<Artist[]> {
  const url = new URL(`${BASE}/search/artists`);
  url.searchParams.set('q', query);
  if (offset != null) url.searchParams.set('offset', offset.toString());
  if (limit  != null) url.searchParams.set('limit',  limit.toString());

  const res = await fetch(url.toString(), { timeout: 5000 });
  if (!res.ok) return [];
  const j = await res.json();
  return j.data || [];
}

export async function getArtistFromDZ(id: string): Promise<any> {
  const url = `${BASE}/artists/${encodeURIComponent(id)}`;
  const res = await fetch(url, { timeout: 5000 });
  if (!res.ok) throw new Error('DZ artist failed');
  return res.json();
}

export async function getAlbumFromDZ(id: string): Promise<any> {
  const url = `${BASE}/albums/${encodeURIComponent(id)}`;
  const res = await fetch(url, { timeout: 5000 });
  if (!res.ok) throw new Error('DZ album failed');
  return res.json();
}