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

# Kopiere run.sh
COPY run.sh /app/run.sh

# Mache run.sh ausführbar
RUN chmod +x /app/run.sh

# Exponiere Ports
EXPOSE 8080 7171 7272

# Health Check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7171/health || exit 1

# Starte die Anwendung
CMD ["/app/run.sh"]