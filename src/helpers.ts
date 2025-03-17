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
 * - Wandelt in Kleinbuchstaben um
 * - Wandelt Akzente in ASCII um (latinize)
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
export function removeKeys(obj: any, keys: any): any {
  for (const prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      if (keys.indexOf(prop) > -1) {
        delete obj[prop];
      } else if (typeof obj[prop] === "object") {
        removeKeys(obj[prop], keys);
      }
    }
  }
  return obj;
}
