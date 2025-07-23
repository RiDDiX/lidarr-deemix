import fetch from 'node-fetch';

export async function searchDeemix(
  query: string,
  offset?: number,
  limit?: number
): Promise<{ name: string }[]> {
  const url = new URL('http://127.0.0.1:7272/search/artists');
  url.searchParams.set('q', query);
  if (offset != null) url.searchParams.set('offset', offset.toString());
  if (limit  != null) url.searchParams.set('limit',  limit.toString());

  const res = await fetch(url.toString(), { timeout: 5000 });
  if (!res.ok) return [];
  return await res.json();
}
