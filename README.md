# Lidarr++Deemix

> **"If Lidarr and Deemix had a child"**

<div align="center">
  <img src="./images/logo.webp" height="200" /><br />
</div>

[![container](https://github.com/RiDDiX/lidarr-deemix/actions/workflows/container.yml/badge.svg?branch=)](https://github.com/RiDDiX/lidarr-deemix/actions/workflows/container.yml)
[![Version](https://img.shields.io/github/tag/RiDDiX/lidarr-deemix.svg?style=flat)]()
[![GitHub stars](https://img.shields.io/github/stars/RiDDiX/lidarr-deemix.svg?style=social&label=Star)]()
[![GitHub watchers](https://img.shields.io/github/watchers/RiDDiX/lidarr-deemix.svg?style=social&label=Watch)]()
[![GitHub forks](https://img.shields.io/github/forks/RiDDiX/lidarr-deemix.svg?style=social&label=Fork)]()

---

## Overview

Lidarr++Deemix extends your existing Lidarr installation by injecting additional artist and album data from Deemix/Deezer—without modifying Lidarr itself.  
By default, data is retrieved from MusicBrainz (which Lidarr normally uses) and, if an artist or album is missing (especially niche or regional content), the fallback source is Deemix.

### Key Features

- **Fallback Integration:**  
  Data is primarily fetched from MusicBrainz (via `artistData.ts`). If an artist or album is missing, Deemix/Deezer is queried instead.

- **Enhanced Duplicate Prevention:**  
  An improved merging algorithm compares normalized titles as well as track counts and track names. This ensures that variants such as "Album" and "Album (Deluxe)" are recognized as duplicates and not added twice.

- **MITM Proxy Integration:**  
  Using [mitmproxy](https://mitmproxy.org/), Lidarr's API calls are intercepted and routed through our NodeJS service (running on port 7171), which enriches the responses with additional data.

- **Performance Optimizations:**  
  Asynchronous batch requests and centralized error handling ensure efficient API calls and system stability under load.

---

## Changelog

### Version 0.21 (2025-03-18)

- **Enhanced Duplicate Detection:**  
  - Introduced the `removeModifiers` function in `helpers.ts` to strip common modifiers like "Deluxe", "Remastered", "Edition", etc. from album titles.
  - Updated `areAlbumsDuplicate` to compare not only normalized titles but also track counts and sorted, normalized track names.
  - Added a new merge function `mergeAlbumListsEnhanced` that replaces the old logic and prevents duplicate entries even when there are slight title variations.

- **Improved Fallback Logic:**  
  - When MusicBrainz data is incomplete or missing, the fallback to Deemix/Deezer is activated.  
  - The enhanced duplicate check is integrated into the fallback process, ensuring that albums with minor variations (e.g., "Album" vs. "Album (Deluxe)") are treated as identical.

- **Performance & Stability:**  
  - Asynchronous batch requests in Deemix functions (e.g., album fetching) have been optimized.
  - Centralized error handling in the Fastify server provides increased robustness during high load.

### Version 0.1

- **Initial Version:**  
  - Integrated Deemix as a fallback for missing MusicBrainz data.
  - Basic duplicate prevention using normalized titles.
  - MITM proxy setup to intercept Lidarr API calls and enrich responses with additional data.

---

## 💡 How It Works

Lidarr normally retrieves artist and album data from its API ([api.lidarr.audio](https://api.lidarr.audio)), which sources information from MusicBrainz.  
Since MusicBrainz often lacks data for regional or niche artists, this tool acts as a proxy that enriches Lidarr's data by querying Deemix/Deezer.

**Detailed Steps:**

1. **MITM Proxy:**  
   - [mitmproxy](https://mitmproxy.org/) intercepts the data traffic from Lidarr.
   - Lidarr is configured to route all API calls through the NodeJS service (running on port 7171).

2. **Data Enrichment:**  
   - **Primary Source:** Data is first fetched from MusicBrainz (via `artistData.ts`).
   - **Fallback Source:** If data is missing or incomplete, Deemix/Deezer is queried.
   - **Merge Process:** The enhanced merge algorithm combines album lists from both sources while preventing duplicates.

3. **Duplicate Check:**  
   - In addition to comparing normalized titles, the system checks track counts and track names.
   - Variants like “Album” and “Album (Deluxe)” are recognized as the same if all other data (such as track list) is identical.

---

## 💻 Installation

> **Note:**  
> This image does not include Lidarr or the Deemix GUI – it is an addition to your existing setup.

1. **Docker Setup:**  
   Use the provided [docker-compose.yml](./docker-compose.yml) as an example.
   - **Environment Variables:**  
     - **DEEMIX_ARL=xxx:** Your Deezer ARL (obtain from your browser's cookies).  
     - **PRIO_DEEMIX=true:** Prioritize Deemix albums when duplicate names are found.  
     - **OVERRIDE_MB=true:** Override MusicBrainz data – **WARNING!** This will remove all previously imported MusicBrainz data.  
     - **LIDARR_URL=http://lidarr:8686:** The URL of your Lidarr instance (with port) for communication (important for OVERRIDE_MB).  
     - **LIDARR_API_KEY=xxx:** Your Lidarr API key.

2. **Lidarr Configuration:**  
   In **Lidarr → Settings → General**, set:
   - **Certificate Validation:** Disabled.
   - **Use Proxy:** Enabled.
   - **Proxy Type:** HTTP(S)
   - **Hostname:** The container name/IP of the machine running Lidarr++Deemix.
   - **Port:** 8080 (or the port you have exposed).
   - **Bypass Proxy for local addresses:** Enabled.

![settings](./images/lidarr-deemix-conf.png)

---

## Summary

- **Enrichment:**  
  Lidarr is enriched with additional artist and album data from Deemix/Deezer, especially for regional or niche content.

- **No Duplicates:**  
  Enhanced duplicate detection (based on normalized titles, track count, and track names) ensures that albums are not added more than once—even if variants like "(Deluxe)" are present.

- **Flexible Fallback Options:**  
  MusicBrainz data is preferred by default; only when missing or incomplete does the system fall back to Deemix/Deezer.

---

## License & Acknowledgements

This project is a fork, expanded and optimized during my spare time.  
Many thanks to all contributors, and especially to @codefaux for previous improvements regarding certificate validation.
