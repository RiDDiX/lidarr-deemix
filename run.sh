#!/bin/bash

# Erstelle Log-Verzeichnis, falls nicht vorhanden
mkdir -p /app/logs

echo "Starte Deemix Server..."
python ./python/deemix-server.py > /app/logs/deemix.log 2>&1 &

echo "Starte NodeJS Proxy Server..."
node ./dist/index.js > /app/logs/server.log 2>&1 &

echo "Starte mitmproxy..."
mitmdump -s ./python/http-redirect-request.py --set stream_large_bodies=1 > /app/logs/mitmdump.log 2>&1 &

echo "Alle Dienste gestartet. Überwache Logs..."
# Überwacht alle Log-Dateien und hält den Container am Leben
# Das -f folgt den Dateien, auch wenn sie neu erstellt werden
tail -F /app/logs/deemix.log /app/logs/server.log /app/logs/mitmdump.log