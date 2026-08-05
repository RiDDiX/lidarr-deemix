# =============================================================================
#  Lidarr-Deemix - Multi-Stage Docker Build
# =============================================================================
# Base image pinned to the Alpine release on purpose: this also pins the
# apk mitmproxy version in the runtime stage (Alpine 3.24 -> mitmproxy 11.0.x).

# =================
#  Stage 1: Builder
# =================
FROM python:3.12-alpine3.24 AS builder

WORKDIR /app

# Build dependencies (all Python deps are pure-python wheels)
RUN apk add --no-cache \
    nodejs \
    npm

# --- Python dependencies ---
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r python/requirements.txt

# --- Node.js dependencies ---
COPY package.json package-lock.json ./
RUN npm ci

# --- TypeScript compilation ---
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# =================
#  Stage 2: Runtime
# =================
FROM python:3.12-alpine3.24

ARG VERSION=2.3.0

LABEL org.opencontainers.image.title="Lidarr-Deemix"
LABEL org.opencontainers.image.description="Enrich Lidarr with Deezer metadata via proxy"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.source="https://github.com/RiDDiX/lidarr-deemix"

WORKDIR /app

# Runtime dependencies only (mitmproxy runs on Alpine's system python)
RUN apk add --no-cache \
    bash \
    curl \
    nodejs \
    mitmproxy

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

# Copy Node modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled JavaScript
COPY --from=builder /app/dist ./dist

# Copy Python scripts
COPY python ./python

# Copy package.json
COPY package.json ./

# Copy and setup run script
COPY run.sh /app/run.sh
RUN chmod +x /app/run.sh

# Create directories
RUN mkdir -p /app/logs /app/config

# Environment defaults
ENV MITM_PORT=8080 \
    PROXY_PORT=7171 \
    DEEMIX_PORT=7272 \
    DEEMIX_URL=http://127.0.0.1:7272 \
    LOG_LEVEL=info \
    NODE_ENV=production

# Expose proxy port (mitmproxy)
EXPOSE 8080

# Health check (check NodeJS API server; follows PROXY_PORT overrides)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -sf "http://localhost:${PROXY_PORT:-7171}/health" || exit 1

# Start application
CMD ["/app/run.sh"]
