#!/bin/bash
set -e

nohup python ./python/deemix-server.py   > /app/nohup_deemix.txt   2>&1 &
nohup pnpm run start                    > /app/nohup_server.txt    2>&1 &
nohup mitmdump -s ./python/http-redirect-request.py > /app/nohup_mitmdump.txt 2>&1 &

tail -f /app/nohup_*.txt
