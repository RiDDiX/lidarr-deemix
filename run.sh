#!/bin/bash
# No -e on purpose: the monitor loop below has to survive service crashes.
set -uo pipefail

mkdir -p /app/logs

echo "╔════════════════════════════════════════════════════╗"
echo "║        Lidarr-Deemix container starting...         ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Default ports
export MITM_PORT=${MITM_PORT:-8080}
export PROXY_PORT=${PROXY_PORT:-7171}
export DEEMIX_PORT=${DEEMIX_PORT:-7272}
DEEMIX_ARL=${DEEMIX_ARL:-}
# Extra mitmdump arguments, e.g. '--proxyauth user:pass'
MITM_EXTRA_ARGS=${MITM_EXTRA_ARGS:-}

DEEMIX_PID=""
NODE_PID=""
MITM_PID=""
DEEMIX_RESTARTS=0
DEEMIX_NEXT_RESTART=0

# Services log to file AND stdout (docker logs).
# The 'exec' matters: without it $! would be the pid of the wrapper
# subshell for the '&&' list, not the actual service, and cleanup()
# would never reach the services.
start_deemix() {
    { cd /app && exec python ./python/deemix-server.py; } > >(tee -a /app/logs/deemix.log) 2>&1 &
    DEEMIX_PID=$!
}

start_node() {
    { cd /app && exec node ./dist/index.js; } > >(tee -a /app/logs/proxy.log) 2>&1 &
    NODE_PID=$!
}

start_mitm() {
    # allow-hosts matches against "host:port" (e.g. api.lidarr.audio:443);
    # everything else is passed through as a raw TCP tunnel.
    # shellcheck disable=SC2086
    { cd /app && exec mitmdump -s ./python/http-redirect-request.py \
        --set stream_large_bodies=10m \
        --listen-port "$MITM_PORT" \
        --allow-hosts "^(api\.lidarr\.audio|ws\.audioscrobbler\.com)(:\\d+)?$" \
        $MITM_EXTRA_ARGS; } > >(tee -a /app/logs/mitmdump.log) 2>&1 &
    MITM_PID=$!
}

# --- Deemix (only with an ARL) ---
if [ -z "$DEEMIX_ARL" ]; then
    echo "⚠️  WARNING: DEEMIX_ARL is not set!"
    echo "   Deezer integration disabled."
    echo "   Only MusicBrainz/Lidarr data will be available."
    echo ""
else
    echo "✓ Deezer ARL token found"
    echo "→ Starting deemix server on port $DEEMIX_PORT..."
    start_deemix

    # The Deezer login can take a while - wait up to 60s for /health
    DEEMIX_UP=false
    for _ in $(seq 1 20); do
        if ! kill -0 "$DEEMIX_PID" 2>/dev/null; then
            break
        fi
        if curl -sf "http://127.0.0.1:$DEEMIX_PORT/health" > /dev/null 2>&1; then
            DEEMIX_UP=true
            break
        fi
        sleep 3
    done
    if [ "$DEEMIX_UP" = true ]; then
        echo "  ✓ Deemix server is up"
    else
        echo "  ⚠️  Deemix server not ready (ARL invalid or expired?)"
        echo "     The monitor keeps trying to restart it (see logs/deemix.log)."
    fi
fi

# --- Node API server ---
echo "→ Starting NodeJS API server on port $PROXY_PORT..."
start_node
sleep 2

if curl -sf "http://127.0.0.1:$PROXY_PORT/health" > /dev/null 2>&1; then
    echo "  ✓ NodeJS API server is up"
else
    echo "  ✗ NodeJS API server failed to start!"
    exit 1
fi

# --- mitmproxy ---
echo "→ Starting mitmproxy on port $MITM_PORT..."
start_mitm
sleep 2

if kill -0 "$MITM_PID" 2>/dev/null; then
    echo "  ✓ mitmproxy is up"
else
    echo "  ✗ mitmproxy failed to start!"
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║             All services started!                  ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║  Proxy port:     $MITM_PORT (external)              "
echo "║  API port:       $PROXY_PORT (internal)             "
if [ -n "$DEEMIX_ARL" ]; then
echo "║  Deemix port:    $DEEMIX_PORT (active)              "
else
echo "║  Deemix port:    $DEEMIX_PORT (disabled)            "
fi
echo "║                                                    ║"
echo "║  Configure Lidarr:                                 ║"
echo "║  → Settings → General → Use Proxy: ✓              ║"
echo "║  → Proxy Type: HTTP(S)                            ║"
echo "║  → Hostname: <container-ip>                       ║"
echo "║  → Port: $MITM_PORT                                 "
echo "║  → Certificate Validation: Disabled               ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Graceful shutdown
cleanup() {
    echo ""
    echo "Shutting down services..."
    [ -n "$DEEMIX_PID" ] && kill "$DEEMIX_PID" 2>/dev/null
    [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
    [ -n "$MITM_PID" ] && kill "$MITM_PID" 2>/dev/null
    wait $DEEMIX_PID $NODE_PID $MITM_PID 2>/dev/null
    echo "All services stopped."
    exit 0
}

trap cleanup SIGTERM SIGINT

# Watch the processes
while true; do
    if ! kill -0 "$MITM_PID" 2>/dev/null; then
        echo "[$(date)] WARNING: mitmproxy crashed! Restarting..."
        start_mitm
    fi

    if ! kill -0 "$NODE_PID" 2>/dev/null; then
        echo "[$(date)] WARNING: NodeJS API server crashed! Restarting..."
        start_node
    fi

    # The deemix server is always watched while an ARL is set, no matter
    # how the initial startup health check went. Crash-looping (e.g. bad
    # ARL or a network outage) backs off up to 5 minutes but never gives
    # up for good - a transient outage should not disable Deezer forever.
    if [ -n "$DEEMIX_ARL" ] && [ -n "$DEEMIX_PID" ]; then
        if ! kill -0 "$DEEMIX_PID" 2>/dev/null; then
            NOW=$(date +%s)
            if [ "$NOW" -ge "$DEEMIX_NEXT_RESTART" ]; then
                DEEMIX_RESTARTS=$((DEEMIX_RESTARTS + 1))
                BACKOFF=$((10 * DEEMIX_RESTARTS * DEEMIX_RESTARTS))
                [ "$BACKOFF" -gt 300 ] && BACKOFF=300
                echo "[$(date)] WARNING: deemix server crashed! Restarting (attempt $DEEMIX_RESTARTS, next retry in ${BACKOFF}s if it keeps crashing - check your ARL)..."
                start_deemix
                DEEMIX_NEXT_RESTART=$((NOW + BACKOFF))
            fi
        else
            DEEMIX_RESTARTS=0
            DEEMIX_NEXT_RESTART=0
        fi
    fi

    # sleep in the background so SIGTERM is handled immediately instead
    # of after up to 10s (docker stop only grants a 10s grace period)
    sleep 10 &
    wait $!
done
