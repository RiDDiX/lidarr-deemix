import { searchDeezerArtists } from "./deemix";
import { searchMusicbrainzArtists } from "./lidarr";

// Helper zum deduplizieren nach Name
function deduplicateArtists(artists: any[]): any[] {
  const seen = new Set();
  return artists.filter((artist) => {
    if (seen.has(artist.name.toLowerCase())) return false;
    seen.add(artist.name.toLowerCase());
    return true;
  });
}

export async function getArtistsFromAllSources(term: string): Promise<any[]> {
  let mbArtists: any[] = [];
  let dzArtists: any[] = [];
  let mbError = false;
  let dzError = false;

  // Musicbrainz/Lidarr
  try {
    mbArtists = await searchMusicbrainzArtists(term);
  } catch {
    mbError = true;
  }

  // Deezer/Deemix
  try {
    dzArtists = await searchDeezerArtists(term);
  } catch {
    dzError = true;
  }

  if (mbError && dzError) {
    return [];
  }

  // Wenn eine Quelle fehlt, nimm nur die andere
  if (mbError) return deduplicateArtists(dzArtists);
  if (dzError) return deduplicateArtists(mbArtists);

  // Beide verfügbar → mergen + deduplizieren
  return deduplicateArtists([...mbArtists, ...dzArtists]);
}
