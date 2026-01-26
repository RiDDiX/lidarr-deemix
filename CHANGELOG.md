# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- mitmproxy requirement (simplified architecture)

### Migration from v1.x

1. Update your docker-compose.yml to use the new image
2. Port remains `8080` - no changes needed in Lidarr
3. Environment variables remain the same

---

## [1.x] - Previous Versions

See the original repository for historical changes:
https://github.com/ad-on-is/lidarr-deemix
