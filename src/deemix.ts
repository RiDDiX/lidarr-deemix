import fetch from 'node-fetch';

export async function searchDeezerArtist(artist: string): Promise<any> {
  // Beispiellogik, Deezer API Endpunkt ggf. anpassen!
  const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
