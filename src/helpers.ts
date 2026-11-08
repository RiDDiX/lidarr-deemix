// helpers.ts
import latinize from "latinize";

/**
 * Normalizes a string for comparisons:
 * - lowercase
 * - accents converted to ASCII (latinize)
 * - everything non-alphanumeric (except spaces) removed
 * - whitespace collapsed
 */
export function normalize(str?: string): string {
  if (!str) return "";
  const result = latinize(str.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  // symbol-only names ("!!!", "+/-") must not all collapse to ""
  return result || str.trim().toLowerCase();
}

/**
 * Recursively removes the given keys from an object.
 */
export function removeKeys(obj: any, keys: string[]): any {
  return JSON.parse(JSON.stringify(obj), (k, v) => (keys.includes(k) ? undefined : v));
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
  /\b(remaster(ed)?|deluxe|edition|version|explicit|expanded|extended|bonus|anniversary|collector'?s?|clean|premium)\b/i;
const LIVE_RE = /\blive\b/i;
// different recordings, not editions: "(Acoustic Version)" must not merge with the album
const DISTINCT_VERSION_RE = /\b(acoustic|instrumental|mono|demo|radio|karaoke|remix|edit)\b/i;

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
    EDITION_KEYWORDS_RE.test(inner) && !LIVE_RE.test(inner) && !DISTINCT_VERSION_RE.test(inner)
      ? " "
      : match
  );

  // 2. strip edition suffixes at the end (with optional separator),
  //    repeated so stacked suffixes like "remastered deluxe" all go
  let prev: string;
  do {
    prev = base;
    for (const suffix of EDITION_SUFFIXES) {
      // matches " - deluxe", " deluxe" (also en/em dash) at the end, but not "unclean"
      const regex = new RegExp(`(?:^|[\\s\\-\\u2013\\u2014:])\\s*[-\\u2013\\u2014:]?\\s*${escapeRegex(suffix)}\\s*$`, "i");
      base = base.replace(regex, "");
    }
  } while (base !== prev);

  // 3. normalize: drop accents, collapse whitespace
  base = latinize(base)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // a title that is nothing but a suffix ("Deluxe") is still its own album
  return base || title.toLowerCase().trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// clean/explicit are content ratings, not editions - a censored "Clean Version"
// must never get the special-edition bonus over the explicit release
const SPECIAL_EDITION_RE = new RegExp(
  `\\b(${EDITION_SUFFIXES.filter((s) => !/clean|explicit/.test(s)).map(escapeRegex).join("|")})\\b`,
  "i"
);

/**
 * True if the album title looks like a special edition (Deluxe, Extended, ...)
 */
export function isSpecialEdition(title: string): boolean {
  return SPECIAL_EDITION_RE.test(title);
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
 * 1. group albums by record type and normalized base title
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

    // a single and an album sharing a name are different releases
    const key = `${album.record_type ?? ""}|${extractBaseTitle(title)}`;

    if (!albumGroups.has(key)) {
      albumGroups.set(key, []);
    }
    albumGroups.get(key)!.push(album);
  }

  const result: any[] = [];

  for (const group of albumGroups.values()) {
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

    result.push(scored[0].album);
  }

  return result;
}
