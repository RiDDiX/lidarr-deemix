// helpers.ts

/**
 * Normalisiert einen String, indem Diakritika entfernt, in Kleinbuchstaben umgewandelt
 * und unerwünschte Zeichen gelöscht werden.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

// Alias export als "normalize"
export const normalize = normalizeTitle;

/**
 * Wandelt einen String in Title Case um.
 */
export function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Fügt zwei Albumlisten zusammen und entfernt Duplikate (basierend auf dem normalisierten Titel).
 */
export function mergeAlbumLists(list1: any[], list2: any[]): any[] {
  const merged = [...list1, ...list2];
  const seen = new Set();
  return merged.filter((album) => {
    // Annahme: Der Titel ist entweder in "Title" oder "title"
    const titleStr = album.Title || album.title || "";
    const norm = normalize(titleStr);
    if (seen.has(norm)) {
      return false;
    }
    seen.add(norm);
    return true;
  });
}

/**
 * Entfernt Duplikate aus einer Albumliste anhand des Titels.
 */
export function deduplicateAlbums(albums: any[]): any[] {
  const seen = new Set();
  return albums.filter((album) => {
    const titleStr = album.Title || album.title || "";
    const norm = normalize(titleStr);
    if (seen.has(norm)) {
      return false;
    }
    seen.add(norm);
    return true;
  });
}

/**
 * Entfernt angegebene Schlüssel aus einem Objekt.
 */
export function removeKeys(obj: any, keys: string[]): any {
  const copy = { ...obj };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}
