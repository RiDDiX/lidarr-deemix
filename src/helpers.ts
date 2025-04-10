// helpers.ts
// Normalisiert einen String: Entfernt diakritische Zeichen, wandelt in Kleinbuchstaben um und trimmt Leerzeichen.
export function normalize(str: string): string {
  return str.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Wandelt einen String in Title Case um.
export function titleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// Fügt zwei Albumlisten zusammen, vermeidet Duplikate.
export function mergeAlbumLists(list1: any[], list2: any[]): any[] {
  const combined = [...list1];
  for (const album of list2) {
    if (!combined.some(a => a.Title.toLowerCase() === album.Title.toLowerCase())) {
      combined.push(album);
    }
  }
  return combined;
}

// Entfernt Duplikate aus einer Albumliste anhand des Titels.
export function deduplicateAlbums(albums: any[]): any[] {
  const deduped: any[] = [];
  for (const album of albums) {
    if (!deduped.some(a => normalize(a.Title) === normalize(album.Title))) {
      deduped.push(album);
    }
  }
  return deduped;
}

// Entfernt aus einem Objekt bestimmte Schlüssel (als string oder Array).
export function removeKeys(obj: any, keys: string | string[]): any {
  const keysArray = Array.isArray(keys) ? keys : [keys];
  const newObj: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !keysArray.includes(key)) {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}
