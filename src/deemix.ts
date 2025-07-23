import axios from 'axios';

const BASE = process.env.DEEMIX_API_BASE || 'http://127.0.0.1:7272';

export async function searchDeemix(
  query: string,
  offset?: number,
  limit?: number
): Promise<{ name: string }[]> {
  const resp = await axios.get(`${BASE}/search/artists`, {
    params: { q: query, offset, limit },
    timeout: 5000
  });
  return resp.data || [];
}
