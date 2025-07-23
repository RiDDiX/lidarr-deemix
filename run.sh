#!/usr/bin/env bash
set -e

# Start Python Deemix server
python python/deemix-server.py &

# Start Node proxy (built JS)
pnpm run start &

# Start mitmproxy
mitmdump -s python/http-redirect-request.py &

# Wait on all
wait
