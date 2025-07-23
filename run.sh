#!/usr/bin/env bash
set -e

# 1) Deemix‑Python-Server
python python/deemix-server.py &

# 2) Node/TS‑Proxy (original index.ts)
ts-node --project tsconfig.tsnode.json src/index.ts &

# 3) mitmdump auf 7171 (Port in http-redirect-request.py)
mitmdump -s python/http-redirect-request.py &

wait