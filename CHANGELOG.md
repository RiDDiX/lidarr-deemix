# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-08-05

### 🩹 Search Fixes, Hardening & Big Cleanup

Went through the whole proxy chain (Lidarr → mitmproxy → Node → Deezer) and fixed everything that didn't match what Lidarr actually expects. Long list, sorry.

#### Fixed
- **Automatic searches**: `search?type=artist` (import lists, automatic artist mapping) got wrapper objects instead of plain artist resources - Lidarr couldn't do anything with those. Now returns the correct format; `type=all` (the manual "Add New" search) keeps the wrappers like before.
- **Album search**: Deezer artists were mixed into `type=album` results, which can abort the whole search in Lidarr. Album searches are now passed through untouched - including the `artist=` and `includeTracks=1` parameters that were previously dropped on the way to the metadata API.
- **Compilations**: Deezer's `record_type` "compile" was mapped to the invalid type "Compile", so Lidarr silently filtered those albums out. They're now `Album` with secondary type `Compilation` (enable "Compilation" in your metadata profile if you want to see them).
- **Multi-disc albums**: track numbers were read from a field that doesn't exist in the Deezer payload (`track_number` instead of `track_position`), so disc 2 kept counting at 13 instead of starting at 1.
- **Album fetch**: an HTTP error while fetching tracks crashed the album mapping half-way. It now fails cleanly, so Lidarr keeps its existing data and retries later instead of persisting an album with an empty track list.
- **Album titles**: no more forced title-casing ("IGOR" became "Igor", "OK Computer" became "Ok Computer"). Original Deezer titles are kept as-is.
- **Dedupe**: "(Live)", "(Vol. 2)" and similar albums were merged into the main album because bracket content was always stripped. Brackets are now only stripped when they contain an edition suffix (Deluxe, Remastered, ...).
- **"Live" detection**: matched on substring, so "Oliver" or "Deliverance" got tagged as live albums. Now matches whole words only.
- **Deemix server**: the error handler caught a `LoginError` that doesn't exist in deezer-py, so any real error ended up as a masked AttributeError and the ARL re-login never ran. Now catches `DeezerError`, re-logins once and retries.
- **docker-compose healthcheck**: probed the mitmproxy port (8080), which has no `/health` route - the container was permanently "unhealthy". Now probes the API server on 7171.
- `npm run dev` works again (`tsc-watch` was missing from the dependencies).

#### Changed
- All Deezer requests have a 10s timeout now. A hung deemix server used to block artist refreshes forever.
- Album search pagination is capped (default 500, configurable via `DEEMIX_MAX_ALBUMS`) - generic artist names like "Muse" no longer trigger dozens of sequential requests per refresh.
- Various-Artists compilations are matched via Deezer's account ID instead of the hardcoded Dutch name "Verschillende artiesten".
- `run.sh` rewritten: waits up to 60s for the Deezer login (was a single check after 3s), keeps monitoring and restarting the deemix server as long as an ARL is set, and mirrors all service logs to stdout so `docker logs` actually shows something. New: `MITM_EXTRA_ARGS` (e.g. `--proxyauth user:pass`).
- Deemix `/health` no longer fires a live Deezer API call on every probe. `/health/deep` still does, for manual checks.
- Scrobbler proxy: no more stale `content-encoding`/`content-length` headers, and form-encoded POSTs are forwarded raw instead of failing with 415/500.
- Error responses keep their real status code instead of turning everything into a 500.
- Python stack: dropped the pip mitmproxy - it was pinned to 10.2.4 but never used at runtime (the container runs the apk package anyway, the pip install just bloated the image). Base image pinned to `python:3.12-alpine3.24`, Flask 2.2.5 → 3.1 (2.2 is EOL), waitress 3.0.0 → 3.0.2 (two known DoS CVEs).

#### Removed
- The `/download` endpoint and the `deemix` pip package. Nothing called that endpoint, it blocked the server while "downloading" and always returned `null`. ARL login and all Deezer searching are untouched - that runs via `deezer-py`, which stays.
- Dead code all over the place, the stale `pnpm-lock.yaml` and a broken tsconfig.

#### Heads up
- `OVERRIDE_MB=true` returns 404 for real MusicBrainz artist IDs again. That's intentional - it prevents mixed MB/Deezer IDs in override mode.
- New albums can show up on the next refresh (compilations, previously-merged "(Live)" editions). With "Monitor: All" artists they may get auto-monitored.
- Album titles switch to their original Deezer spelling on refresh (cosmetic, matching runs on IDs).
- Port 8080 is an anonymous forward proxy - don't expose it to the internet. See the security note in the README.

---

## [2.2.0] - 2026-02-18

### 🔧 Proxy & Indexer Fix

#### Fixed
- **Indexer/Release Search**: mitmproxy no longer MITM's indexer, download client and notification traffic. Added `--allow-hosts` so only `api.lidarr.audio` and `ws.audioscrobbler.com` are intercepted — all other HTTPS connections pass through as clean TCP tunnels
- **Spotify API Bypass**: Fixed broken condition in `http-redirect-request.py` where `pretty_host` (hostname only) was compared against a full URL — Spotify API passthrough never worked
- **Audioscrobbler Proxy**: `ws.audioscrobbler.com` was redirected to the Node.js server but no route handler existed (404). Scrobbler routes now properly registered
- **Catch-All Proxy**: POST/PUT/PATCH requests (e.g. `search/fingerprint`) lost their body and headers. Now correctly forwarded to `api.lidarr.audio`
- **Scrobbler Robustness**: Handle both JSON and XML responses from audioscrobbler (previously crashed on XML, which is the default format)

#### Added
- **GitHub Release Workflow**: Automatic GitHub Releases with changelog extraction on version tags
- **Docker Version Tags**: Images now also tagged with major version (e.g. `ghcr.io/riddix/lidarr-deemix:2`)
- **Support Section**: PayPal donation link in README

#### Changed
- **mitmproxy Script**: Complete rewrite with configurable `INTERCEPTED_HOSTS`, `PASSTHROUGH_PATHS`, and proper path-based filtering
- **Docker Build**: Bumped `build-push-action` to v6, added QEMU setup, VERSION build-arg for image labels

---

## [2.1.0] - 2026-01-26

### 🎯 Smart Album Deduplication

#### Added
- **Smart Album Deduplication**: Intelligent detection and merging of duplicate albums
  - Detects different editions of the same album (Deluxe, Extended, Remastered, etc.)
  - Groups albums by base title (e.g., "Album", "Album (Deluxe)", "Album [Remastered]" → one group)
  - Automatically selects the "best" version based on scoring system
- **Album Scoring System**: Quality rating for albums
  - Track count: More tracks = higher score
  - Explicit version: Uncensored versions are preferred
  - Edition preference: Configurable via `PREFER_SPECIAL_EDITIONS`
- **New Environment Variable**: `PREFER_SPECIAL_EDITIONS`
  - `false` (default): Original albums are preferred
  - `true`: Deluxe/Extended editions are preferred
- **Logging**: Detailed logs during album deduplication show selected and discarded versions

#### Changed
- **Edition Detection**: Comprehensive list of edition suffixes (Deluxe, Extended, Remastered, Anniversary, Collector's, etc.)
- **Base Title Extraction**: Removes brackets `()`, `[]`, `{}` and edition suffixes for correct grouping

#### Fixed
- **Duplicate Handling**: Deezer often returns multiple versions of the same album - now only the best one is kept
- **False Positives**: "Album 1" and "Album 1 Part 2" are correctly recognized as different albums

---

## [2.0.0] - 2026-01-17

### 🚀 Major Release - Complete Rewrite

#### Changed
- **Architecture**: Replaced `http-proxy-middleware` with native Node.js `fetch` for better reliability
- **Simplified Setup**: Removed mitmproxy dependency - now runs as a simple HTTP proxy
- **TypeScript**: Added comprehensive type definitions for Lidarr and Deezer APIs
- **Docker**: Optimized multi-stage build, reduced image size
- **Startup**: Improved container startup with health checks and better logging

#### Fixed
- **URL Encoding**: Fixed search queries with spaces (e.g., "Daft Punk") not returning results
- **Error Handling**: Deemix failures no longer break MusicBrainz data retrieval
- **Memory Leaks**: Removed unused dependencies (`http-proxy-middleware`, `node-fetch`)

#### Added
- **Optional Deezer**: Container now works without `DEEMIX_ARL` (MusicBrainz proxy only)
- **Health Endpoints**: `/health` endpoint for container orchestration
- **Better Logging**: Structured JSON logging with configurable log levels
- **Type Safety**: Full TypeScript types for API responses

#### Removed
- `http-proxy-middleware` dependency
- `node-fetch` dependency (using native fetch)
- ~~mitmproxy requirement (simplified architecture)~~ (reverted shortly after - HTTPS proxy tunneling needs mitmproxy, it's been a core component ever since)

### Migration from v1.x

1. Update your docker-compose.yml to use the new image
2. Port remains `8080` - no changes needed in Lidarr
3. Environment variables remain the same

---

## [1.x] - Previous Versions

See the original repository for historical changes:
https://github.com/ad-on-is/lidarr-deemix
