// helpers.ts
// Diese Datei enthält Hilfsfunktionen für Formatierung und Zusammenführung von Daten.

export function normalize(str: string): string {
  // Entfernt diakritische Zeichen, wandelt in Kleinbuchstaben und trimmt Leerzeichen
  return str.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function titleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

export function mergeAlbumLists(list1: any[], list2: any[]): any[] {
  const combined = [...list1];
  for (const album of list2) {
    if (!combined.some(a => a.Title.toLowerCase() === album.Title.toLowerCase())) {
      combined.push(album);
    }
  }
  return combined;
}

// Falls gewünscht, kannst du auch deduplicateAlbums exportieren;
// in deemix.ts wird bereits eine eigene Funktion dafür genutzt.
export function deduplicateAlbums(albums: any[]): any[] {
  const deduped: any[] = [];
  for (const album of albums) {
    if (!deduped.some(a => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}
