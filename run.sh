#!/usr/bin/env bash
set -e

python python/deemix-server.py &
node dist/index.js &
mitmdump -s python/http-redirect-request.py &

wait