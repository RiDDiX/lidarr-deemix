# syntax=docker/dockerfile:1.4

########################################
# 1) Python‑Builder: Deemix‑Server
########################################
FROM python:3.12-slim AS python-builder

WORKDIR /opt/deemix-python

# System‑Deps für Deemix
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc \
      libffi-dev \
      pkg-config \
      libssl-dev \
 && rm -rf /var/lib/apt/lists/*

# Python‑Requirements installieren
COPY python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

########################################
# 2) Node‑Builder: TypeScript/Node‑App
########################################
FROM node:18-alpine AS node-builder

WORKDIR /app

# Lockfile‑Mismatch umgehen
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@8 \
 && pnpm install --no-frozen-lockfile

# Quellcode kopieren und builden
COPY . .
RUN pnpm run build

########################################
# 3) Runtime‑Image
########################################
FROM debian:bookworm-slim AS runtime

# Arbeitsverzeichnis
WORKDIR /app

# Runtime‑Deps installieren: Node + Python
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nodejs \
      python3 \
      python3-pip \
 && rm -rf /var/lib/apt/lists/*

# 3.1) Kopiere und installiere Node‑App
COPY --from=node-builder /app/dist ./dist
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@8 \
 && pnpm install --no-frozen-lockfile --prod

# 3.2) Kopiere Python‑Server
COPY --from=python-builder /opt/deemix-python /opt/deemix-python
COPY python/deemix-server.py python/http-redirect-request.py ./

# 3.3) Dein Start‑Script
COPY run.sh .
RUN chmod +x run.sh

# Ports exposen – getrennt, ohne Kommentar inline!
EXPOSE 8080
EXPOSE 7272

# Standard‑Kommando: run.sh startet beide Services
CMD ["./run.sh"]
