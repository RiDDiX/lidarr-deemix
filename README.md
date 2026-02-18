<div align="center">
<img src="./images/logo.webp" height="200" /><br />
<h1>Lidarr-Deemix</h1>
<h4><i>"Enrich Lidarr with Deezer metadata"</i></h4>

[![Docker Build](https://github.com/RiDDiX/lidarr-deemix/actions/workflows/container.yml/badge.svg)](https://github.com/RiDDiX/lidarr-deemix/actions/workflows/container.yml)
[![Version](https://img.shields.io/github/v/release/RiDDiX/lidarr-deemix?style=flat)](https://github.com/RiDDiX/lidarr-deemix/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/riddix/lidarr-deemix?style=flat)](https://github.com/RiDDiX/lidarr-deemix/pkgs/container/lidarr-deemix)

</div>

---

## 🎯 What it does

Lidarr uses MusicBrainz (via `api.lidarr.audio`) for artist/album metadata. However, MusicBrainz is often incomplete, especially for regional or niche artists.

**Lidarr-Deemix** acts as a transparent proxy that:
- Intercepts Lidarr's API requests to `api.lidarr.audio`
- Enriches the results with additional artists/albums from **Deezer**
- Returns combined results to Lidarr - no modifications to Lidarr needed!

## ✨ Features

- 🔍 **Enhanced Search** - Find artists/albums that MusicBrainz doesn't have
- 🎨 **Album Art** - Automatic cover images from Deezer
- 🔄 **Seamless Integration** - Works as a drop-in proxy, no Lidarr modifications
- 🐳 **Docker Ready** - Multi-arch images (amd64/arm64)
- ⚡ **Lightweight** - Alpine-based, minimal footprint

---

## 🚀 Quick Start

### Docker Compose (Recommended)

```yaml
version: '3.8'
services:
  lidarr-deemix:
    image: ghcr.io/riddix/lidarr-deemix:latest
    container_name: lidarr-deemix
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - DEEMIX_ARL=your_deezer_arl_token_here
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
```

### Get your Deezer ARL Token

1. Log into [deezer.com](https://www.deezer.com)
2. Open browser DevTools (F12) → Application → Cookies
3. Find the `arl` cookie and copy its value

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEEMIX_ARL` | - | **Required** for Deezer integration. Your Deezer ARL token |
| `PORT` | `8080` | Proxy server port |
| `PRIO_DEEMIX` | `false` | Prioritize Deezer albums over MusicBrainz |
| `OVERRIDE_MB` | `false` | Use Deezer data only (ignores MusicBrainz) |
| `PREFER_SPECIAL_EDITIONS` | `false` | Prefer Deluxe/Extended editions over standard albums |
| `LIDARR_URL` | - | Your Lidarr instance URL (for advanced features) |
| `LIDARR_API_KEY` | - | Your Lidarr API key (for advanced features) |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

### Lidarr Setup

1. Go to **Settings → General**
2. Configure proxy settings:
   - **Use Proxy:** ✅ Enabled
   - **Proxy Type:** HTTP(S)
   - **Hostname:** IP/hostname of lidarr-deemix container
   - **Port:** `8080`
   - **Bypass Proxy for Local Addresses:** ✅ Enabled
3. Set **Certificate Validation:** to `Disabled`
4. Click **Save**

![Lidarr Settings](./images/lidarr-deemix-conf.png)

---

## 🔧 Advanced Usage

### Without Deezer (MusicBrainz Proxy Only)

You can run without a Deezer ARL - it will just proxy MusicBrainz requests:

```yaml
environment:
  # No DEEMIX_ARL set - Deezer features disabled
```

### Override MusicBrainz Completely

Use only Deezer data (useful if MusicBrainz data is wrong):

```yaml
environment:
  - DEEMIX_ARL=your_arl
  - OVERRIDE_MB=true
  - LIDARR_URL=http://lidarr:8686
  - LIDARR_API_KEY=your_api_key
```

> ⚠️ **Warning:** This will remove all MusicBrainz-imported artists/albums!

---

## 📊 Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Lidarr    │────▶│  Lidarr-Deemix   │────▶│ api.lidarr.audio│
│             │     │   (Proxy:8080)   │     │   (MusicBrainz) │
└─────────────┘     │                  │     └─────────────────┘
                    │        +         │
                    │    ┌───────┐     │
                    │    │Deemix │     │
                    │    │Server │     │
                    │    └───────┘     │
                    └──────────────────┘
```

---

## 🐛 Troubleshooting

### Check container logs
```bash
docker logs lidarr-deemix
```

### Health check
```bash
curl http://localhost:8080/health
```

### Common issues

| Issue | Solution |
|-------|----------|
| "ARL invalid" | Get a fresh ARL token from Deezer |
| Connection refused | Check if port 8080 is exposed and accessible |
| No Deezer results | Verify DEEMIX_ARL is set correctly |

---

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

---

## 🙏 Credits

- Original project by [ad-on-is](https://github.com/ad-on-is/lidarr-deemix)
- [Deemix](https://deemix.app/) for Deezer integration
- [Lidarr](https://lidarr.audio/) for being awesome

---

## ☕ Support

> **Dieses Projekt ist und bleibt kostenlos und Open Source.**
> Ich entwickle es in meiner Freizeit, weil mir Open Source am Herzen liegt.

Wenn dir das Projekt gefällt oder weiterhilft, kannst du mich gerne unterstützen:

[![PayPal](https://img.shields.io/badge/PayPal-Spenden-blue?logo=paypal&style=for-the-badge)](https://www.paypal.me/RiDDiX93)

Jede Unterstützung hilft bei Hosting-Kosten und motiviert zur Weiterentwicklung. Danke! ❤️

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details
