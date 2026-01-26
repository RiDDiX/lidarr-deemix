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

/**
 * Edition-Suffixe die auf erweiterte Album-Versionen hinweisen.
 * Sortiert nach Länge (längste zuerst) für korrektes Matching.
 */
const EDITION_SUFFIXES = [
  // Längere zuerst für korrektes Matching
  "super deluxe edition",
  "super deluxe version",
  "collectors edition",
  "collector's edition",
  "anniversary edition",
  "international version",
  "bonus tracks version",
  "bonus track version",
  "remastered edition",
  "remastered version",
  "complete edition",
  "complete version",
  "expanded edition",
  "expanded version",
  "ultimate edition",
  "ultimate version",
  "special edition",
  "special version",
  "limited edition",
  "deluxe edition",
  "deluxe version",
  "premium edition",
  "premium version",
  "extended edition",
  "extended version",
  "tour edition",
  "super deluxe",
  "remastered",
  "remaster",
  "expanded",
  "extended",
  "explicit",
  "premium",
  "deluxe",
  "clean version",
  "clean",
];

/**
 * Extrahiert den Base-Titel eines Albums ohne Edition-Suffixe und Klammern.
 * 
 * Beispiele:
 * - "Album 1 (Deluxe Edition)" → "album 1"
 * - "Album 1 - Deluxe" → "album 1"
 * - "Album 1 [Remastered]" → "album 1"
 * - "Album 1 Part 2" → "album 1 part 2" (bleibt erhalten!)
 */
export function extractBaseTitle(title: string): string {
  let base = title.toLowerCase().trim();
  
  // 1. Entferne Klammer-Inhalte: (Deluxe Edition), [Remastered], etc.
  base = base.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*/g, " ");
  
  // 2. Entferne Edition-Suffixe am Ende (mit optionalem Trennzeichen davor)
  for (const suffix of EDITION_SUFFIXES) {
    // Match: " - deluxe", " – deluxe", " deluxe" am Ende
    const regex = new RegExp(`\\s*[-–—:]?\\s*${escapeRegex(suffix)}\\s*$`, "i");
    base = base.replace(regex, "");
  }
  
  // 3. Normalisiere: Akzente entfernen, mehrfache Leerzeichen bereinigen
  base = latinize(base)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  return base;
}

/**
 * Escaped Regex-Sonderzeichen in einem String.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prüft ob ein Album-Titel eine spezielle Edition ist (Deluxe, Extended, etc.)
 */
export function isSpecialEdition(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  
  // Prüfe ob ein Suffix im Titel vorkommt
  return EDITION_SUFFIXES.some((suffix) => lowerTitle.includes(suffix));
}

/**
 * Berechnet einen Qualitäts-Score für ein Album.
 * Höherer Score = besseres/vollständigeres Album.
 * 
 * Scoring-Logik:
 * - Basis-Score für alle Alben
 * - Bonus für mehr Tracks (Deluxe hat oft mehr Tracks)
 * - Bonus/Malus für Special Editions je nach Präferenz
 * - Explizite Version bevorzugt (uncensored = vollständiger)
 */
export function calculateAlbumScore(album: any, preferSpecialEditions: boolean): number {
  let score = 100; // Basis-Score
  
  const title = album["title"] || album["Title"] || "";
  const nbTracks = album["nb_tracks"] || 0;
  const isExplicit = album["explicit_lyrics"] === true;
  const isSpecial = isSpecialEdition(title);
  
  // Track-Anzahl: Mehr Tracks = vollständigeres Album
  // +1 Punkt pro Track, max +30
  score += Math.min(nbTracks, 30);
  
  // Spezial-Editionen
  if (preferSpecialEditions) {
    // Deluxe/Extended bevorzugen: +25 Bonus
    if (isSpecial) score += 25;
  } else {
    // Original bevorzugen: Spezial-Editionen bekommen Malus
    // ABER: Wenn Spezial mehr Tracks hat, kann es trotzdem gewinnen
    if (isSpecial) score -= 15;
  }
  
  // Explizite Version: +10 (uncensored ist vollständiger)
  if (isExplicit) score += 10;
  
  return score;
}

/**
 * Dedupliziert Alben intelligent.
 * 
 * Logik:
 * 1. Gruppiere Alben nach normalisiertem Base-Titel
 * 2. Innerhalb jeder Gruppe: Wähle das Album mit dem höchsten Score
 * 3. Bei gleichem Score: Nimm das mit mehr Tracks
 * 
 * @param albums Array von Deezer-Album-Objekten (Rohdaten)
 * @returns Dedupliziertes Array mit den besten Versionen
 */
export function deduplicateAlbums(albums: any[]): any[] {
  if (!albums || albums.length === 0) return [];
  
  const preferSpecial = process.env.PREFER_SPECIAL_EDITIONS === "true";
  const albumGroups = new Map<string, any[]>();
  
  // Gruppiere Alben nach Base-Titel
  for (const album of albums) {
    const title = album["title"] || "";
    if (!title) continue;
    
    const baseTitle = extractBaseTitle(title);
    if (!baseTitle) continue;
    
    if (!albumGroups.has(baseTitle)) {
      albumGroups.set(baseTitle, []);
    }
    albumGroups.get(baseTitle)!.push(album);
  }
  
  // Wähle das beste Album aus jeder Gruppe
  const result: any[] = [];
  
  for (const [baseTitle, group] of albumGroups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    
    // Berechne Scores und sortiere
    const scored = group
      .map((album) => ({
        album,
        score: calculateAlbumScore(album, preferSpecial),
        tracks: album["nb_tracks"] || 0,
      }))
      .sort((a, b) => {
        // Primär nach Score
        if (b.score !== a.score) return b.score - a.score;
        // Sekundär nach Track-Anzahl
        return b.tracks - a.tracks;
      });
    
    const best = scored[0];
    const alternatives = scored.slice(1).map((s) => s.album["title"]).join(", ");
    
    console.log(
      `[Dedupe] "${baseTitle}": Gewählt "${best.album["title"]}" ` +
      `(Score: ${best.score}, Tracks: ${best.tracks}) | ` +
      `Verworfen: ${alternatives}`
    );
    
    result.push(best.album);
  }
  
  return result;
}
