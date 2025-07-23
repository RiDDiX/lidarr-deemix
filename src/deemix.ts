import axios from 'axios';

const URL = process.env.DEEMIX_API_URL || 'http://deemix:7272';

export async function searchDeemix(term: string): Promise<any[]> {
  const resp = await axios.get(`${URL}/search/artists`, {
    params: { q: term },
    timeout: 2000,
  });
  // Deezer liefert { data: [...] }
  return resp.data.data || [];
}