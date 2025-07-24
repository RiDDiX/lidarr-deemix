// helpers.ts
import latinize from "latinize";

/**
 * Wandelt einen String in Title Case um.
 */
export function titleCase(str: string): string {
  const splitStr = str.toLowerCase().split(" ");
  for (let i = 0; i < splitStr.length; i++) {
    splitStr[i] = splitStr[i].charAt(0).toUpperCase() + splitStr[i].substring(1);
  }
  return splitStr.join(" ");
}

/**
 * Normalisiert einen String:
 * - Umwandlung in Kleinbuchstaben
 * - Umwandlung von Akzenten in ASCII (latinize)
 * - Entfernt alle nicht-alphanumerischen Zeichen (außer Leerzeichen)
 * - Bereinigt überflüssigen Whitespace
 */
export function normalize(str: string): string {
  return latinize(str.toLowerCase())
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Entfernt aus einem Objekt alle Keys, die in keys angegeben sind.
 */
export function removeKeys(obj: any, keys: string[]): any {
  for (const prop in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
      if (keys.indexOf(prop) > -1) {
        delete obj[prop];
      } else if (typeof obj[prop] === "object" && obj[prop] !== null) {
        removeKeys(obj[prop], keys);
      }
    }
  }
  return obj;
}

/**
 * Fügt zwei Albumlisten zusammen, ohne Duplikate.
 * Die Duplikaterkennung erfolgt anhand des normalisierten Titels.
 */
export function mergeAlbumLists(primary: any[], secondary: any[]): any[] {
  const albumMap = new Map<string, any>();
  for (const album of primary) {
    albumMap.set(normalize(album.Title), album);
  }
  for (const album of secondary) {
    const key = normalize(album.Title);
    if (!albumMap.has(key)) {
      albumMap.set(key, album);
    }
  }
  return Array.from(albumMap.values());
}
