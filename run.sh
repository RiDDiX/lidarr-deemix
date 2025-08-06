#!/bin/bash

# Erstelle Log-Verzeichnis
mkdir -p /app/logs

echo "========================================="
echo "  Lidarr-Deemix Container startet..."
echo "========================================="

# Prüfe ob ARL gesetzt ist
if [ -z "$DEEMIX_ARL" ]; then
    echo "FEHLER: DEEMIX_ARL Umgebungsvariable nicht gesetzt!"
    echo "Bitte setze deine Deezer ARL in der Docker-Konfiguration."
    exit 1
fi

echo "✓ ARL Token gefunden"
echo ""

# Starte Services
echo "Starte Deemix Server auf Port 7272..."
python ./python/deemix-server.py > /app/logs/deemix.log 2>&1 &
DEEMIX_PID=$!

# Warte kurz auf Deemix Start
sleep 3

echo "Starte NodeJS Proxy Server auf Port 7171..."
node ./dist/index.js > /app/logs/server.log 2>&1 &
NODE_PID=$!

# Warte kurz auf Node Start
sleep 2

echo "Starte mitmproxy auf Port 8080..."
mitmdump -s ./python/http-redirect-request.py --set stream_large_bodies=1 --listen-port 8080 > /app/logs/mitmdump.log 2>&1 &
MITM_PID=$!

echo ""
echo "========================================="
echo "  Alle Services gestartet!"
echo "========================================="
echo ""
echo "  Proxy Port: 8080"
echo "  API Port: 7171"
echo "  Deemix Port: 7272"
echo ""
echo "  Logs werden geschrieben nach:"
echo "  - /app/logs/deemix.log"
echo "  - /app/logs/server.log"
echo "  - /app/logs/mitmdump.log"
echo ""
echo "========================================="

# Funktion für sauberes Beenden
cleanup() {
    echo ""
    echo "Fahre Services herunter..."
    kill $DEEMIX_PID $NODE_PID $MITM_PID 2>/dev/null
    wait $DEEMIX_PID $NODE_PID $MITM_PID 2>/dev/null
    echo "Alle Services beendet."
    exit 0
}

# Signal-Handler registrieren
trap cleanup SIGTERM SIGINT

# Überwache die Prozesse
while true; do
    # Prüfe ob alle Prozesse noch laufen
    if ! kill -0 $DEEMIX_PID 2>/dev/null; then
        echo "WARNUNG: Deemix Server ist abgestürzt! Starte neu..."
        python ./python/deemix-server.py > /app/logs/deemix.log 2>&1 &
        DEEMIX_PID=$!
    fi
    
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "WARNUNG: Node Proxy ist abgestürzt! Starte neu..."
        node ./dist/index.js > /app/logs/server.log 2>&1 &
        NODE_PID=$!
    fi
    
    if ! kill -0 $MITM_PID 2>/dev/null; then
        echo "WARNUNG: mitmproxy ist abgestürzt! Starte neu..."
        mitmdump -s ./python/http-redirect-request.py --set stream_large_bodies=1 --listen-port 8080 > /app/logs/mitmdump.log 2>&1 &
        MITM_PID=$!
    fi
    
    # Warte 10 Sekunden bis zur nächsten Prüfung
    sleep 10
done