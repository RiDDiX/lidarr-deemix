#!/usr/bin/env bash
# 1) Deemix‑Server (Python)
nohup python3 ./python/deemix-server.py > nohup_deemix.txt 2>&1 &
# 2) TypeScript‑Proxy
nohup npm start > nohup_server.txt 2>&1 &
# 3) mitmproxy
nohup mitmdump -s ./python/http-redirect-request.py > nohup_mitm.txt 2>&1 &

tail -f nohup_*.txt
