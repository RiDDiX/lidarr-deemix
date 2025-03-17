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
 * - Kleinbuchstaben
 * - Akzente werden in ASCII umgewandelt (latinize)
 * - Alle nicht-alphanumerischen Zeichen (außer Leerzeichen) werden entfernt
 * - Überflüssiger Whitespace wird bereinigt
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
