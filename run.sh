#!/usr/bin/env bash
set -e

# 1) Deemix‑Server (intern auf 7272)
nohup python3 python/deemix-server.py > /app/log_deemix.txt 2>&1 &

# 2) Fastify‑Proxy (intern auf 7171)
nohup pnpm run start       > /app/log_node.txt 2>&1 &

# 3) MITM‑Proxy als einziger externer Port 8080
nohup mitmdump \
     --listen-port 8080 \
     -s python/http-redirect-request.py \
     > /app/log_mitm.txt 2>&1 &

# Log‑Tail
tail -F /app/log_*.txt
