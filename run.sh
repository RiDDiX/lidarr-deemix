#!/usr/bin/env bash
set -e

# 1) Starte Deemix‑Flask‑API im Hintergrund
nohup python -u ./deemix-server.py \
  > /root/nohup_deemix.txt 2>&1 &

# 2) Starte mitmproxy (für Redirects) im Hintergrund
nohup mitmdump -s http-redirect-request.py \
  > /root/nohup_mitmdump.txt 2>&1 &

# 3) Starte deinen Node/TS‑Server
#    Hier nehmen wir an, dass in dist/index.js dein Fastify/Express liegt
nohup node dist/index.js \
  > /root/nohup_server.txt 2>&1 &

# 4) Warte auf alle Child‑Prozesse (damit Docker-Container nicht sofort endet)
wait
