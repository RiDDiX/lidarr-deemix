import axios from 'axios';

const BASE = process.env.LIDARR_API_BASE || 'https://api.lidarr.audio/api/v0.4';

export async function searchMusicbrainz(
  query: string,
  offset?: number,
  limit?: number
): Promise<{ name: string }[]> {
  const resp = await axios.get(`${BASE}/search`, {
    params: { type: 'artist', query, offset, limit },
    timeout: 5000
  });
  // resp.data.artists || resp.data.results || resp.data
  return resp.data.artists || resp.data;
}
