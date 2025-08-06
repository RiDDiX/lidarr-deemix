# =================
#  Stufe 1: Builder
# =================
FROM python:3.12-alpine AS builder

WORKDIR /app

# Installiere Build-Tools
RUN apk add --no-cache \
    bash \
    build-base \
    libffi-dev \
    nodejs \
    npm \
    openssl-dev

# Installiere pnpm global
RUN npm i -g pnpm

# --- Python Abhängigkeiten ---
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r python/requirements.txt

# --- Node.js Abhängigkeiten ---
# Kopiere package.json (ohne pnpm-lock.yaml, da die Versionen nicht übereinstimmen)
COPY package.json ./

# Installiere Dependencies ohne Lock-File
RUN pnpm install --no-frozen-lockfile

# Kopiere TypeScript-Source
COPY tsconfig.json ./
COPY src ./src

# Kompiliere TypeScript
RUN pnpm run build

# =================
#  Stufe 2: Runtime
# =================
FROM python:3.12-alpine

WORKDIR /app

# Installiere nur Runtime-Abhängigkeiten
RUN apk add --no-cache nodejs mitmproxy bash

# Kopiere Python-Pakete vom Builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

# Kopiere Node-Module vom Builder
COPY --from=builder /app/node_modules ./node_modules

# Kopiere kompilierten JavaScript-Code
COPY --from=builder /app/dist ./dist

# Kopiere Python-Skripte
COPY python ./python

# Kopiere package.json für Node
COPY package.json ./

# Erstelle run.sh
RUN cat > /app/run.sh << 'EOF'
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
EOF

# Mache run.sh ausführbar
RUN chmod +x /app/run.sh

# Exponiere Ports
EXPOSE 8080 7171 7272

# Health Check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7171/health || exit 1

# Starte die Anwendung
CMD ["/app/run.sh"]