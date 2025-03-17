import { getLidarrArtist } from "./lidarr.js";
import { getAritstByName } from "./deemix.js";

/**
 * Sucht einen Künstler anhand des Namens:
 * 1. Primär: Über Lidarr/MusicBrainz (getLidarrArtist)
 * 2. Fallback: Über Deezer/Deemix (getAritstByName), falls FALLBACK_DEEZER nicht auf "false" gesetzt ist.
 *
 * Um den Fallback zu deaktivieren, setze in Deiner Umgebung:
 *    export FALLBACK_DEEZER=false
 */
export async function getArtistData(query: string): Promise<any> {
  const mbArtist = await getLidarrArtist(query);
  if (mbArtist) {
    return mbArtist;
  }
  if (process.env.FALLBACK_DEEZER !== "false") {
    return await getAritstByName(query);
  }
  return null;
}
