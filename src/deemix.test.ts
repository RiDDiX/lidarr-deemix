import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fakeId,
  decodeFakeId,
  isFakeId,
  sortName,
  isLiveTitle,
  deemixAlbum,
  getAlbums,
  getArtist,
  search,
} from "./deemix.js";
import { getAllLidarrArtists } from "./lidarr.js";
import type { DeemixEntityType } from "./types.js";

const TYPES: DeemixEntityType[] = ["artist", "album", "track", "release", "recording"];

test("fakeId round-trips through decodeFakeId for every prefix", () => {
  for (const type of TYPES) {
    for (const id of [0, 7, 123456789012, 1234567890123]) {
      const fake = fakeId(id, type);
      assert.ok(isFakeId(fake, type), fake);
      assert.equal(decodeFakeId(fake, type), String(id));
    }
  }
});

test("fakeId format is unchanged", () => {
  assert.equal(fakeId(7, "artist"), "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7");
  assert.equal(fakeId(123456789012, "album"), "bbbbbbbb-bbbb-bbbb-bbbb-123456789012");
});

test("decodeFakeId rejects non-numeric suffixes and real UUIDs", () => {
  assert.equal(decodeFakeId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa..", "artist"), null);
  assert.equal(decodeFakeId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "artist"), null);
  assert.equal(decodeFakeId("5b11f4ce-a62d-471e-81fc-a69a8278c7da", "artist"), null);
  // right shape, wrong type prefix
  assert.equal(decodeFakeId(fakeId(7, "album"), "artist"), null);
});

test("isFakeId rejects malformed strings", () => {
  for (const id of [
    undefined,
    null,
    "",
    "aaaaaaaa-aaaa-aaaa-aaaa-",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa..",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaa7/../x",
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAA7",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa7",
  ]) {
    assert.equal(isFakeId(id, "artist"), false, String(id));
  }
});

test("sortName reverses words", () => {
  assert.equal(sortName("Guns N' Roses"), "Roses, N', Guns");
  assert.equal(sortName("Adele"), "Adele");
});

test("isLiveTitle only tags live recordings", () => {
  for (const t of ["Alive (Live)", "Hits [Live]", "Song - Live", "Live at Wembley", "Live in Berlin", "Live From Austin"]) {
    assert.equal(isLiveTitle(t), true, t);
  }
  for (const t of ["Live and Let Die", "Oliver", "Deliverance", "Alive", ""]) {
    assert.equal(isLiveTitle(t), false, t);
  }
});

// routes Deemix URLs to canned [status, body] replies; restores fetch afterwards
async function withFetch(routes: Record<string, [number, unknown]>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const path = new URL(String(input)).pathname;
    const [status, body] = routes[path] ?? [404, {}];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("deemixAlbum returns null for Deezer error payloads and HTTP errors", async () => {
  await withFetch(
    {
      "/albums/1": [200, { error: { type: "DataException", code: 800 } }],
      "/albums/2": [500, {}],
      "/albums/3": [200, { id: 3, title: "Ok" }],
    },
    async () => {
      assert.equal(await deemixAlbum("1"), null);
      assert.equal(await deemixAlbum("2"), null);
      assert.equal((await deemixAlbum("3"))?.title, "Ok");
    }
  );
});

test("getAlbums filters search hits by artist id and VA titles by whole word", async () => {
  await withFetch(
    {
      "/artists/42": [
        200,
        { id: 42, name: "Yes", albums: { data: [{ id: 1, title: "Fragile", record_type: "album" }] } },
      ],
      "/search/albums": [
        200,
        {
          total: 4,
          data: [
            { id: 2, title: "Close to the Edge", record_type: "album", artist: { id: 42, name: "Yes" } },
            { id: 3, title: "Same Name Band", record_type: "album", artist: { id: 99, name: "Yes" } },
            { id: 4, title: "Best of Yes", record_type: "compile", artist: { id: 5080 } },
            { id: 5, title: "Eyes Wide Open", record_type: "compile", artist: { id: 5080 } },
          ],
        },
      ],
    },
    async () => {
      const titles = (await getAlbums("Yes", 42)).map((a) => a.Title).sort();
      assert.deepEqual(titles, ["Best of Yes", "Close to the Edge", "Fragile"]);
    }
  );
});

const DEEZER_ARTISTS: [number, unknown] = [
  200,
  {
    data: [
      { id: 42, name: "Yes", picture_xl: "yes.jpg", link: "https://deezer/42", type: "artist" },
      { id: 7, name: "Yes Band", picture_xl: "band.jpg", link: "https://deezer/7", type: "artist" },
    ],
  },
];
const lidarrWrapper = () => ({ artist: { artistname: "Yes", images: [], oldids: [] }, album: null });

test("search enriches the matching Lidarr artist and appends the rest", async () => {
  await withFetch({ "/search/artists": DEEZER_ARTISTS }, async () => {
    const res = await search([lidarrWrapper()], "Yes", true);
    assert.deepEqual(res[0].artist.images, [{ CoverType: "Poster", Url: "yes.jpg" }]);
    assert.deepEqual(res[0].artist.oldids, [fakeId(42, "artist")]);
    assert.equal(res.length, 2);
    assert.equal(res[1].artist.artistname, "Yes Band");
  });
});

test("search with OVERRIDE_MB returns only Deezer artists", async () => {
  const prev = process.env.OVERRIDE_MB;
  process.env.OVERRIDE_MB = "true";
  try {
    await withFetch({ "/search/artists": DEEZER_ARTISTS }, async () => {
      const res = await search([lidarrWrapper()], "Yes", true);
      assert.deepEqual(res.map((r) => r.artist.id), [fakeId(42, "artist"), fakeId(7, "artist")]);
    });
  } finally {
    if (prev === undefined) delete process.env.OVERRIDE_MB;
    else process.env.OVERRIDE_MB = prev;
  }
});

test("getArtist merges Deezer albums missing by normalized title", async () => {
  const discography = [
    { id: 1, title: "Fragile", record_type: "album" },
    { id: 2, title: "Close to the Edge", record_type: "album" },
  ];
  await withFetch(
    {
      "/search/artists": DEEZER_ARTISTS,
      "/artists/42": [200, { id: 42, name: "Yes", albums: { data: discography } }],
      "/search/albums": [200, { total: 0, data: [] }],
    },
    async () => {
      const res = await getArtist({ artistname: "Yes", images: [], Albums: [{ Title: "fragile!" }] });
      assert.deepEqual(res.Albums.map((a: any) => a.Title), ["fragile!", "Close to the Edge"]);
      assert.equal(res.images[0].Url, "yes.jpg");
    }
  );
});

test("a failing Lidarr fetch is negatively cached", async () => {
  const env = { url: process.env.LIDARR_URL, key: process.env.LIDARR_API_KEY };
  const original = globalThis.fetch;
  let calls = 0;
  process.env.LIDARR_URL = "http://lidarr.invalid";
  process.env.LIDARR_API_KEY = "k";
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("down");
  }) as typeof fetch;
  try {
    assert.deepEqual(await getAllLidarrArtists(), []);
    assert.deepEqual(await getAllLidarrArtists(), []);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of [["LIDARR_URL", env.url], ["LIDARR_API_KEY", env.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
