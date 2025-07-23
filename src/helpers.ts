export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mergeArtists<T extends { name: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const artist of [...a, ...b]) {
    const key = normalizeTitle(artist.name);
    if (!map.has(key)) map.set(key, artist);
  }
  return Array.from(map.values());
}
