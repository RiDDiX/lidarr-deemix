import { getLidarrArtist } from "./lidarr.js";
import { getAritstByName } from "./deemix.js";

/**
 * Sucht einen Künstler anhand des Namens:
 * 1. Primär: Über Lidarr/MusicBrainz (getLidarrArtist)
 * 2. Falls kein Ergebnis gefunden wird und FALLBACK_DEEZER nicht auf "false" gesetzt ist,
 *    wird Deezer/Deemix (getAritstByName) genutzt.
 */
export async function getArtistData(query: string): Promise<any> {
  const mbArtist = await getLidarrArtist(query);
  if (mbArtist) return mbArtist;
  if (process.env.FALLBACK_DEEZER !== "false") {
    return await getAritstByName(query);
  }
  return null;
}
