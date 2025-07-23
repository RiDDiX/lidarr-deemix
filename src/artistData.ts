import { deemixSearch, deemixArtist } from "./deemix.js";
import { normalize } from "./helpers.js";

export async function getArtistData(query: string): Promise<any> {
  if (!query) return null;

  try {
    const results = await deemixSearch(query);
    if (!results || results.length === 0) return null;

    const artist = results.find((r) => normalize(r.artist.name) === normalize(query)) || results[0];
    if (!artist || !artist.artist || !artist.artist.id) return null;

    const artistId = artist.artist.id;
    return await deemixArtist(artistId);
  } catch (err) {
    console.error("Error in getArtistData:", err);
    return null;
  }
}
