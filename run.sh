#!/bin.bash

# Erstelle Log-Verzeichnis, falls nicht vorhanden
mkdir -p /app/logs

echo "Starte Deemix Server im Hintergrund..."
python ./python/deemix-server.py > /app/logs/deemix.log 2>&1 &

# WICHTIG: Gib dem Deemix-Server kurz Zeit zum Initialisieren
echo "Warte 5 Sekunden, damit der Deemix-Server vollständig starten kann..."
sleep 5

echo "Starte NodeJS Proxy Server im Hintergrund..."
node ./dist/index.js > /app/logs/server.log 2>&1 &

echo "Starte mitmproxy..."
# mitmdump läuft im Vordergrund und hält den Container am Leben.
mitmdump -s ./python/http-redirect-request.py --set stream_large_bodies=1 > /app/logs/mitmdump.log 2>&1 &

# tail wird hier nicht mehr benötigt, da mitmdump den Container aktiv hält.
# Falls der Container sich dennoch beendet, kann die folgende Zeile wieder einkommentiert werden.
# tail -F /app/logs/deemix.log /app/logs/server.log /app/logs/mitmdump.log