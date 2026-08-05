// helpers.ts
import latinize from "latinize";

/**
 * Normalizes a string for comparisons:
 * - lowercase
 * - accents converted to ASCII (latinize)
 * - everything non-alphanumeric (except spaces) removed
 * - whitespace collapsed
 */
export function normalize(str: string): string {
  return latinize(str.toLowerCase())
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Recursively removes the given keys from an object.
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
 * Edition suffixes that mark extended/alternate album versions.
 * Longest first so the longer variants match before their substrings.
 */
const EDITION_SUFFIXES = [
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
 * Bracket content is only stripped when it contains an edition keyword -
 * "(Live)", "(Vol. 2)" or "(Acoustic)" are separate albums and must not
 * get merged into the main album.
 */
const EDITION_KEYWORDS_RE =
  /remaster|deluxe|edition|version|explicit|expanded|extended|bonus|anniversary|collector|clean|premium/i;

/**
 * Extracts the base title of an album, without edition suffixes.
 *
 * Examples:
 * - "Album 1 (Deluxe Edition)" -> "album 1"
 * - "Album 1 - Deluxe"         -> "album 1"
 * - "Album 1 [Remastered]"     -> "album 1"
 * - "Album 1 (Live)"           -> "album 1 live" (stays separate!)
 * - "Album 1 Part 2"           -> "album 1 part 2" (stays separate!)
 */
export function extractBaseTitle(title: string): string {
  let base = title.toLowerCase().trim();

  // 1. strip bracket content ONLY when it contains edition keywords:
  //    (Deluxe Edition), [Remastered], ... - but not (Live), (Vol. 2)
  base = base.replace(/\s*[\(\[\{]([^\)\]\}]*)[\)\]\}]\s*/g, (match, inner) =>
    EDITION_KEYWORDS_RE.test(inner) ? " " : match
  );

  // 2. strip edition suffixes at the end (with optional separator)
  for (const suffix of EDITION_SUFFIXES) {
    // matches " - deluxe", " – deluxe", " deluxe" at the end
    const regex = new RegExp(`\\s*[-–—:]?\\s*${escapeRegex(suffix)}\\s*$`, "i");
    base = base.replace(regex, "");
  }

  // 3. normalize: drop accents, collapse whitespace
  base = latinize(base)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return base;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True if the album title looks like a special edition (Deluxe, Extended, ...)
 */
export function isSpecialEdition(title: string): boolean {
  const lowerTitle = title.toLowerCase();
  return EDITION_SUFFIXES.some((suffix) => lowerTitle.includes(suffix));
}

/**
 * Quality score for an album - higher score = better/more complete version.
 *
 * - base score for every album
 * - bonus for more tracks (deluxe usually has more)
 * - bonus/penalty for special editions depending on preference
 * - explicit versions preferred (uncensored = complete)
 */
export function calculateAlbumScore(album: any, preferSpecialEditions: boolean): number {
  let score = 100;

  const title = album["title"] || album["Title"] || "";
  const nbTracks = album["nb_tracks"] || 0;
  const isExplicit = album["explicit_lyrics"] === true;
  const isSpecial = isSpecialEdition(title);

  // +1 per track, capped at +30
  score += Math.min(nbTracks, 30);

  if (preferSpecialEditions) {
    if (isSpecial) score += 25;
  } else {
    // prefer the original, but a special edition with more tracks can still win
    if (isSpecial) score -= 15;
  }

  if (isExplicit) score += 10;

  return score;
}

/**
 * Deduplicates albums:
 * 1. group albums by normalized base title
 * 2. within each group, keep the album with the highest score
 * 3. ties are broken by track count
 *
 * @param albums raw Deezer album objects
 * @returns deduplicated array with the best version of each album
 */
export function deduplicateAlbums(albums: any[]): any[] {
  if (!albums || albums.length === 0) return [];

  const preferSpecial = process.env.PREFER_SPECIAL_EDITIONS === "true";
  const albumGroups = new Map<string, any[]>();

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

  const result: any[] = [];

  for (const [baseTitle, group] of albumGroups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const scored = group
      .map((album) => ({
        album,
        score: calculateAlbumScore(album, preferSpecial),
        tracks: album["nb_tracks"] || 0,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.tracks - a.tracks;
      });

    const best = scored[0];
    const alternatives = scored.slice(1).map((s) => s.album["title"]).join(", ");

    console.log(
      `[dedupe] "${baseTitle}": picked "${best.album["title"]}" ` +
      `(score: ${best.score}, tracks: ${best.tracks}) | ` +
      `dropped: ${alternatives}`
    );

    result.push(best.album);
  }

  return result;
}
