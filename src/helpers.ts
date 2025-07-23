export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mergeArtists<T extends { name: string }>(mb: T[], dz: T[]): T[] {
  const seen = new Map<string, T>();
  for (const artist of [...mb, ...dz]) {
    const key = normalizeTitle(artist.name);
    if (!seen.has(key)) seen.set(key, artist);
  }
  return Array.from(seen.values());
}