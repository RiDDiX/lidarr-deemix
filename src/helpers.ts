export function deduplicateArtists(l1: any[], l2: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const a of [...l1, ...l2]) {
    const name = (a.artistName || a.name || '').toLowerCase().trim();
    const id = String(a.foreignArtistId || a.artistId || '');
    const key = name + '|' + id;
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}