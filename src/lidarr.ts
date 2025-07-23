import axios from 'axios';

const URL = process.env.LIDARR_API_URL || 'http://lidarr:8686/api/v1';

export async function searchLidarr(term: string): Promise<any[]> {
  const resp = await axios.get(`${URL}/search`, {
    params: { term, type: 'artist' },
    timeout: 2000,
  });
  // Lidarr liefert { artists: [...] }
  return resp.data.artists || [];
}