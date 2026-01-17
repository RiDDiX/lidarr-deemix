#!/bin/bash

# Erstelle Log-Verzeichnis
mkdir -p /app/logs

echo "╔════════════════════════════════════════════════════╗"
echo "║       Lidarr-Deemix v2.0 Container startet...      ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Prüfe ob ARL gesetzt ist
if [ -z "$DEEMIX_ARL" ]; then
    echo "⚠️  WARNUNG: DEEMIX_ARL nicht gesetzt!"
    echo "   Deezer-Integration wird deaktiviert."
    echo "   Nur MusicBrainz/Lidarr-Daten verfügbar."
    echo ""
    DEEMIX_ENABLED=false
else
    echo "✓ Deezer ARL Token gefunden"
    DEEMIX_ENABLED=true
fi

# Setze Standard-Ports falls nicht definiert
export PORT=${PORT:-8080}
export DEEMIX_PORT=${DEEMIX_PORT:-7272}

echo ""
echo "Starte Services..."
echo ""

# Starte Deemix Server nur wenn ARL vorhanden
if [ "$DEEMIX_ENABLED" = true ]; then
    echo "→ Starte Deemix Server auf Port $DEEMIX_PORT..."
    cd /app && python ./python/deemix-server.py > /app/logs/deemix.log 2>&1 &
    DEEMIX_PID=$!
    sleep 3
    
    # Health Check für Deemix
    if curl -sf http://127.0.0.1:$DEEMIX_PORT/health > /dev/null 2>&1; then
        echo "  ✓ Deemix Server läuft"
    else
        echo "  ⚠️  Deemix Server konnte nicht starten (ARL ungültig?)"
        DEEMIX_ENABLED=false
    fi
else
    DEEMIX_PID=""
fi

echo "→ Starte Proxy Server auf Port $PORT..."
cd /app && node ./dist/index.js > /app/logs/proxy.log 2>&1 &
NODE_PID=$!
sleep 2

# Health Check für Node
if curl -sf http://127.0.0.1:$PORT/health > /dev/null 2>&1; then
    echo "  ✓ Proxy Server läuft"
else
    echo "  ✗ Proxy Server konnte nicht starten!"
    cat /app/logs/proxy.log
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║            Alle Services gestartet!                ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║  Proxy Port:     $PORT                              "
if [ "$DEEMIX_ENABLED" = true ]; then
echo "║  Deemix Port:    $DEEMIX_PORT (aktiv)               "
else
echo "║  Deemix Port:    $DEEMIX_PORT (deaktiviert)         "
fi
echo "║                                                    ║"
echo "║  Konfiguriere Lidarr:                              ║"
echo "║  → Settings → General → Use Proxy: ✓              ║"
echo "║  → Proxy Type: HTTP(S)                            ║"
echo "║  → Hostname: <container-ip>                       ║"
echo "║  → Port: $PORT                                      "
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Funktion für sauberes Beenden
cleanup() {
    echo ""
    echo "Fahre Services herunter..."
    [ -n "$DEEMIX_PID" ] && kill $DEEMIX_PID 2>/dev/null
    [ -n "$NODE_PID" ] && kill $NODE_PID 2>/dev/null
    wait $DEEMIX_PID $NODE_PID 2>/dev/null
    echo "Alle Services beendet."
    exit 0
}

# Signal-Handler registrieren
trap cleanup SIGTERM SIGINT

# Überwache die Prozesse
while true; do
    # Prüfe Node Proxy
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "[$(date)] WARNUNG: Proxy Server abgestürzt! Neustart..."
        cd /app && node ./dist/index.js >> /app/logs/proxy.log 2>&1 &
        NODE_PID=$!
    fi
    
    # Prüfe Deemix Server (nur wenn aktiviert)
    if [ "$DEEMIX_ENABLED" = true ] && [ -n "$DEEMIX_PID" ]; then
        if ! kill -0 $DEEMIX_PID 2>/dev/null; then
            echo "[$(date)] WARNUNG: Deemix Server abgestürzt! Neustart..."
            cd /app && python ./python/deemix-server.py >> /app/logs/deemix.log 2>&1 &
            DEEMIX_PID=$!
        fi
    fi
    
    sleep 10
done