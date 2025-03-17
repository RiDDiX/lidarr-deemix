import { normalize } from "./helpers.js";

const lidarrApiUrl = "https://api.lidarr.audio";

/**
 * Sucht einen einzelnen Künstler in Lidarr anhand des Namens.
 * Dabei wird geprüft, ob der zurückgegebene Datensatz
 * kein Album (album === null) enthält und der normalisierte Künstlername exakt passt.
 */
export async function getLidarrArtist(name: string) {
  try {
    const res = await fetch(
      `${lidarrApiUrl}/api/v0.4/search?type=all&query=${encodeURIComponent(name)}`
    );
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }
    const json = (await res.json()) as any[];
    const a = json.find(
      (a) =>
        a["album"] === null &&
        a["artist"] &&
        normalize(a["artist"]["artistname"]) === normalize(name)
    );
    if (typeof a !== "undefined") {
      return a["artist"];
    }
    return null;
  } catch (error) {
    console.error("Error fetching Lidarr artist:", error);
    return null;
  }
}

/**
 * Holt alle Künstler aus der Lidarr-Instanz.
 * Die URL und der API-Key werden aus den Umgebungsvariablen gelesen.
 */
export async function getAllLidarrArtists() {
  try {
    const url = `${process.env.LIDARR_URL}/api/v1/artist`;
    const apiKey = process.env.LIDARR_API_KEY as string;
    if (!url || !apiKey) {
      throw new Error("LIDARR_URL or LIDARR_API_KEY not defined");
    }
    const res = await fetch(url, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }
    const json = (await res.json()) as any[];
    return json;
  } catch (error) {
    console.error("Error fetching all Lidarr artists:", error);
    return [];
  }
}
