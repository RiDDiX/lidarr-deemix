# Troubleshooting

If you're a developer or tinkerer, this one is for you.

## First steps

```bash
# Container logs (all three services log to stdout)
docker logs lidarr-deemix

# Per-service logs inside the container
docker exec lidarr-deemix tail -50 /app/logs/proxy.log
docker exec lidarr-deemix tail -50 /app/logs/deemix.log
docker exec lidarr-deemix tail -50 /app/logs/mitmdump.log

# Health checks
docker exec lidarr-deemix curl -sf http://localhost:7171/health   # Node API server
docker exec lidarr-deemix curl -sf http://localhost:7272/health   # Deemix server (login state)
docker exec lidarr-deemix curl -sf http://localhost:7272/health/deep  # Deemix with live Deezer call
```

## Local testing

The easiest way to test locally is to:

- Clone Lidarr
- Build Lidarr
- Clone this repo
- Install mitmproxy
- Run Lidarr and this repo locally

### 1 Clone and Build Lidarr

You need `dotnet` installed for this. See [Lidarr contribution guide](https://wiki.servarr.com/lidarr/contributing) for further information.

```bash
git clone https://github.com/Lidarr/Lidarr.git
cd Lidarr
dotnet msbuild -restore src/Lidarr.sln -p:Configuration=Debug -p:Platform=Posix -t:PublishAllRids
# grab a coffee
```

### 2 Clone this repo and install deps

You'll need **python and nodejs (with npm)** for this one. Also, download and install [mitmproxy](https://mitmproxy.org/) on your system.

```bash
git clone https://github.com/RiDDiX/lidarr-deemix.git
cd lidarr-deemix
npm ci
python -m pip install -r python/requirements.txt
```

### 3 Run

```bash
# terminal 1 (lidarr-deemix):
npm run dev
# terminal 2 (lidarr-deemix):
DEEMIX_ARL=xxxx python ./python/deemix-server.py
# terminal 3 (lidarr-deemix):
mitmweb -s ./python/http-redirect-request.py # opens a browser where you can inspect the requests from Lidarr

# terminal 4 (Lidarr)
./_output/net6.0/linux-x64/Lidarr # this will open a new browser
```

## Getting help

Open an issue or discussion: https://github.com/RiDDiX/lidarr-deemix/discussions
