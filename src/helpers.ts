export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')                   // Unicode‑Normalisierung
    .replace(/[\u0300-\u036f]/g, '')     // Akzente entfernen
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')         // Sonderzeichen weg
    .replace(/\s+/g, ' ')                // Mehrfach‑Spaces zu einem
    .trim();
}

export function mergeArtists<T extends { name: string }>(mb: T[], dz: T[]): T[] {
  const seen = new Map<string, T>();
  for (const artist of [...mb, ...dz]) {
    const key = normalizeTitle(artist.name);
    if (!seen.has(key)) {
      seen.set(key, artist);
    }
  }
  return Array.from(seen.values());
}