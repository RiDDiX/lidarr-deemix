# syntax=docker/dockerfile:1

#######################################
# 1) Frontend bauen
#######################################
FROM node:18-alpine AS frontend
WORKDIR /app

# pnpm exakt auf deine Lockfile‑Version pinnen
ARG PNPM_VERSION=6.32.10
RUN npm install -g pnpm@$PNPM_VERSION

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Quell‑Files kopieren und build ausführen
COPY . .
RUN pnpm run build

#######################################
# 2) Python‑Dependencies bauen
#######################################
FROM python:3.12-slim AS builder
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc libffi-dev pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

#######################################
# 3) Fertiges Runtime‑Image
#######################################
FROM python:3.12-slim AS runtime
WORKDIR /app

# Nur ca‑certificates für TLS
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Python‑Pakete kopieren
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Deine Flask‑App kopieren
COPY deemix-server.py ./

# Statische Frontend‑Assets
COPY --from=frontend /app/build ./static

# Auf Port 8080 laufen lassen
EXPOSE 8080
ENV DEEMIX_ARL=${DEEMIX_ARL}

# waitress auf Port 8080
CMD ["waitress-serve", "--listen=0.0.0.0:8080", "deemix-server:app"]
