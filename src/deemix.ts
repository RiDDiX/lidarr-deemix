import fetch from 'node-fetch';
import latinize from 'latinize';

export async function searchDeezerArtist(artist: string) {
  // Query Deezer's API directly
  const q = encodeURIComponent(latinize(artist));
  const url = `https://api.deezer.com/search/artist?q=${q}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data || !data.data) return [];
  // Convert Deezer result into Lidarr-friendly minimal format
  return data.data.map((artistObj: any) => ({
    id: artistObj.id,
    name: artistObj.name,
    link: artistObj.link,
    picture: artistObj.picture_medium || artistObj.picture_small,
    nb_album: artistObj.nb_album,
    nb_fan: artistObj.nb_fan
  }));
}
