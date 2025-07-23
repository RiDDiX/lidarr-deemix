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

  try {
    const res = await fetch(url.toString(), { timeout: 5000 });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}