# =============================================================================
#  Lidarr-Deemix v2.0 - Multi-Stage Docker Build
# =============================================================================

# =================
#  Stage 1: Builder
# =================
FROM python:3.12-alpine AS builder

WORKDIR /app

# Build dependencies
RUN apk add --no-cache \
    bash \
    build-base \
    curl \
    libffi-dev \
    nodejs \
    npm \
    openssl-dev

# --- Python dependencies ---
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r python/requirements.txt

# --- Node.js dependencies ---
COPY package.json ./
RUN npm install --omit=dev

# --- TypeScript compilation ---
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =================
#  Stage 2: Runtime
# =================
FROM python:3.12-alpine

LABEL org.opencontainers.image.title="Lidarr-Deemix"
LABEL org.opencontainers.image.description="Enrich Lidarr with Deezer metadata via proxy"
LABEL org.opencontainers.image.version="2.0.0"
LABEL org.opencontainers.image.source="https://github.com/RiDDiX/lidarr-deemix"

WORKDIR /app

# Runtime dependencies only
RUN apk add --no-cache \
    bash \
    curl \
    nodejs

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
RUN mkdir -p /app/logs /app/config /app/downloads

# Environment defaults
ENV PORT=8080 \
    DEEMIX_PORT=7272 \
    DEEMIX_URL=http://127.0.0.1:7272 \
    LOG_LEVEL=info \
    NODE_ENV=production

# Expose proxy port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -sf http://localhost:${PORT}/health || exit 1

# Start application
CMD ["/app/run.sh"]