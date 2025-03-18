import { normalize } from "./helpers.js";

const lidarrApiUrl = "https://api.lidarr.audio";

/**
 * Sucht einen einzelnen Künstler in Lidarr anhand des Namens.
 */
export async function getLidarrArtist(name: string): Promise<any | null> {
  try {
    const res = await fetch(
      `${lidarrApiUrl}/api/v0.4/search?type=all&query=${encodeURIComponent(name)}`
    );
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }
    const jsonRaw: unknown = await res.json();
    if (!Array.isArray(jsonRaw)) {
      throw new Error("Erwartetes Array nicht erhalten");
    }
    const json = jsonRaw as any[];
    const a = json.find(
      (a) =>
        a["album"] === null &&
        a["artist"] &&
        normalize(a["artist"]["artistname"]) === normalize(name)
    );
    return typeof a !== "undefined" ? a["artist"] : null;
  } catch (error) {
    console.error("Error fetching Lidarr artist:", error);
    return null;
  }
}

/**
 * Holt alle Künstler aus der Lidarr-Instanz.
 */
export async function getAllLidarrArtists(): Promise<any[]> {
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
    const jsonRaw: unknown = await res.json();
    if (!Array.isArray(jsonRaw)) {
      throw new Error("Erwartetes Array nicht erhalten");
    }
    return jsonRaw as any[];
  } catch (error) {
    console.error("Error fetching all Lidarr artists:", error);
    return [];
  }
}
