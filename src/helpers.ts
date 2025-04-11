export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/**
 * Führt zwei Künstlerarrays zusammen und entfernt Duplikate anhand des normalisierten Namens.
 */
export function mergeArtists(
  artistsA: { name: string }[],
  artistsB: { name: string }[]
): { name: string }[] {
  const mergedMap: Record<string, { name: string }> = {};

  [...artistsA, ...artistsB].forEach((artist) => {
    if (artist?.name) {
      const norm = normalizeTitle(artist.name);
      if (!mergedMap[norm]) {
        mergedMap[norm] = artist;
      }
    }
  });
  return Object.values(mergedMap);
}
