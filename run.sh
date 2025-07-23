#!/usr/bin/env bash
set -e

# Start Deemix Python API
python python/deemix-server.py &

# Start Node/TS proxy (original index.ts)
ts-node --project tsconfig.tsnode.json src/index.ts &

# Start mitmdump on 7171
mitmdump -s python/http-redirect-request.py &

wait