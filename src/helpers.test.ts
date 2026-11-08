import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  extractBaseTitle,
  deduplicateAlbums,
  isSpecialEdition,
  removeKeys,
} from "./helpers.js";

test("normalize keeps non-Latin names distinct", () => {
  const distinct: [string, string][] = [
    ["Кино", "Ария"],
    ["宇多田ヒカル", "椎名林檎"],
    ["!!!", "+/-"],
  ];
  for (const [a, b] of distinct) {
    assert.notEqual(normalize(a), "", a);
    assert.notEqual(normalize(a), normalize(b), `${a} vs ${b}`);
  }
  assert.equal(normalize("Beyoncé!"), "beyonce");
  assert.equal(normalize(undefined), "");
});

test("extractBaseTitle", () => {
  const cases: [string, string][] = [
    ["Unclean", "unclean"],
    ["Album Remastered Deluxe", "album"],
    ["Album 1 (Deluxe Edition)", "album 1"],
    ["Album 1 - Deluxe", "album 1"],
    ["Album (Live)", "album live"],
    ["Deluxe", "deluxe"],
  ];
  for (const [title, expected] of cases) {
    assert.equal(extractBaseTitle(title), expected, title);
  }
  assert.notEqual(extractBaseTitle("Album (Live at X - Deluxe Edition)"), extractBaseTitle("Album"));
  assert.equal(extractBaseTitle("東京事変 (Deluxe Edition)"), "東京事変");
  assert.notEqual(extractBaseTitle("Album (Acoustic Version)"), extractBaseTitle("Album"));
  assert.notEqual(extractBaseTitle("Album (Radio Edit)"), extractBaseTitle("Album"));
  assert.equal(extractBaseTitle("Album (Deluxe Version)"), extractBaseTitle("Album"));
});

test("deduplicateAlbums", () => {
  const single = { title: "Song", record_type: "single", nb_tracks: 1 };
  const album = { title: "Song", record_type: "album", nb_tracks: 12 };
  assert.deepEqual(deduplicateAlbums([single, album]), [single, album]);

  const explicit = { title: "Album", record_type: "album", nb_tracks: 10, explicit_lyrics: true };
  const clean = { title: "Album (Clean Version)", record_type: "album", nb_tracks: 10, explicit_lyrics: false };
  assert.deepEqual(deduplicateAlbums([clean, explicit]), [explicit]);

  const prev = process.env.PREFER_SPECIAL_EDITIONS;
  process.env.PREFER_SPECIAL_EDITIONS = "true";
  try {
    assert.deepEqual(deduplicateAlbums([clean, explicit]), [explicit]);
  } finally {
    if (prev === undefined) delete process.env.PREFER_SPECIAL_EDITIONS;
    else process.env.PREFER_SPECIAL_EDITIONS = prev;
  }
});

test("isSpecialEdition", () => {
  assert.equal(isSpecialEdition("Album (Clean Version)"), false);
  assert.equal(isSpecialEdition("Album (Explicit)"), false);
  assert.equal(isSpecialEdition("Album (Deluxe Edition)"), true);
  assert.equal(isSpecialEdition("Undeluxed"), false);
});

test("removeKeys does not mutate its input", () => {
  const input = { mbid: "x", a: { mbid: "y", b: [{ mbid: "z", c: 1 }] } };
  const before = structuredClone(input);
  assert.deepEqual(removeKeys(input, ["mbid"]), { a: { b: [{ c: 1 }] } });
  assert.deepEqual(input, before);
});
