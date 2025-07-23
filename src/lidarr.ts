import fetch from 'node-fetch';
import { ArtistData, getArtistData } from './artistData.js';

export interface Artist { name: string; [key: string]: any }

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

  const res = await fetch(url.toString(), { timeout: 5000 });
  if (!res.ok) return [];
  const data = await res.json();
  return data.artists || [];
}

export async function getArtistFromMB(id: string): Promise<any> {
  const url = `${BASE}/artist/${encodeURIComponent(id)}`;
  const res = await fetch(url, { timeout: 5000 });
  if (!res.ok) throw new Error('MB artist failed');
  return res.json();
}

export async function getAlbumFromMB(id: string): Promise<any> {
  const url = `${BASE}/album/${encodeURIComponent(id)}`;
  const res = await fetch(url, { timeout: 5000 });
  if (!res.ok) throw new Error('MB album failed');
  return res.json();
}