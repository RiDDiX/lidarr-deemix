#!/usr/bin/env bash
set -e

# start Python Deemix‑Server
python python/deemix-server.py &
# build & start Node‑Proxy
pnpm run start &
# start mitmproxy
mitmdump -s python/http-redirect-request.py &

# wait on all
wait
