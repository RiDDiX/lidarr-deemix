// lidarr.ts

const ARTIST_CACHE_TTL = 60_000;

let artistCache: any[] | null = null;
let artistCacheTime = 0;

/**
 * Fetches all artists from the Lidarr instance (60s cache - this is
 * needed on every fake-album request).
 */
export async function getAllLidarrArtists(): Promise<any[]> {
  const baseUrl = process.env.LIDARR_URL;
  const apiKey = process.env.LIDARR_API_KEY;
  if (!baseUrl || !apiKey) {
    return [];
  }

  const now = Date.now();
  if (artistCache && now - artistCacheTime < ARTIST_CACHE_TTL) {
    return artistCache;
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/artist`, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }
    const jsonRaw: unknown = await res.json();
    if (!Array.isArray(jsonRaw)) {
      throw new Error("Expected an array response");
    }
    artistCache = jsonRaw as any[];
    artistCacheTime = now;
    return artistCache;
  } catch (error) {
    console.error("Error fetching all Lidarr artists:", error);
    return [];
  }
}
