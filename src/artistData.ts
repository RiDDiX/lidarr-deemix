import { deemixSearch, deemixArtist } from "./deemix.js";
import { normalize } from "./helpers.js";

export async function getArtistData(query: string): Promise<any> {
  if (!query) return null;
  try {
    const results = await deemixSearch(query);
    if (!results.length) return null;
    const match = results.find(r => normalize(r.artist?.name) === normalize(query)) || results[0];
    return match.artist?.id ? await deemixArtist(match.artist.id) : null;
  } catch (err) {
    console.error("getArtistData error:", err);
    return null;
  }
}
