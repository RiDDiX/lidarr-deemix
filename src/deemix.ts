import fetch from "node-fetch";

const baseUrl = "https://api.deezer.com";

export async function deemixSearch(query: string): Promise<any[]> {
  try {
    const res = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}`);
    const json = await res.json();
    return json?.data || [];
  } catch (err) {
    console.error("deemixSearch error:", err);
    return [];
  }
}

export async function deemixArtist(id: string): Promise<any> {
  try {
    const res = await fetch(`${baseUrl}/artist/${id}`);
    const artist = await res.json();
    const albumsRes = await fetch(`${baseUrl}/artist/${id}/albums`);
    const albumsJson = await albumsRes.json();
    artist.Albums = albumsJson?.data || [];
    return artist;
  } catch (err) {
    console.error("deemixArtist error:", err);
    return null;
  }
}

export async function getAlbum(id: string): Promise<any> {
  try {
    const res = await fetch(`${baseUrl}/album/${id}`);
    return await res.json();
  } catch (err) {
    console.error("getAlbum error:", err);
    return null;
  }
}
