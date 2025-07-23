// src/deemix.ts
import fetch from "node-fetch";
import { normalize } from "./helpers.js";

const DEEZER_API = "https://api.deezer.com";

export async function deemixSearch(query: string): Promise<any[]> {
  try {
    const res = await fetch(`${DEEZER_API}/search/artist?q=${encodeURIComponent(query)}`);
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.error("Error in deemixSearch:", err);
    return [];
  }
}

export async function deemixArtist(id: string): Promise<any> {
  try {
    const artistRes = await fetch(`${DEEZER_API}/artist/${id}`);
    const artist = await artistRes.json();

    const albumsRes = await fetch(`${DEEZER_API}/artist/${id}/albums`);
    const albumsJson = await albumsRes.json();

    const albums = (albumsJson.data || []).map((album: any) => ({
      Id: `album-bbbb-${album.id}`,
      Title: album.title,
      ReleaseDate: album.release_date || "0000-00-00",
      Url: album.link,
    }));

    return {
      Id: `artist-aaaa-${artist.id}`,
      Name: artist.name,
      Albums: albums,
    };
  } catch (err) {
    console.error("Error in deemixArtist:", err);
    return null;
  }
}

export async function getAlbum(id: string): Promise<any> {
  try {
    const res = await fetch(`${DEEZER_API}/album/${id}`);
    const album = await res.json();

    const tracks = (album.tracks?.data || []).map((track: any, index: number) => ({
      TrackNumber: index + 1,
      Title: track.title,
      Duration: track.duration,
    }));

    return {
      Id: `album-bbbb-${album.id}`,
      Title: album.title,
      ReleaseDate: album.release_date || "0000-00-00",
      Url: album.link,
      Tracks: tracks,
    };
  } catch (err) {
    console.error("Error in getAlbum:", err);
    return null;
  }
}
