# syntax=docker/dockerfile:1.4

#######################################
# 1) Python Build Stage
#######################################
FROM python:3.12-slim AS python-builder

WORKDIR /opt/deemix-python

# Copy und installiere nur die Python-Dependencies
COPY python/requirements.txt .
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc libffi-dev pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir -r requirements.txt

# Kopiere den Rest deines python-Service
COPY python/ .

#######################################
# 2) Node Build Stage
#######################################
FROM node:18-alpine AS node-builder

WORKDIR /app

# Copy der package-Dateien und Installation
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@8 \
 && pnpm install --no-frozen-lockfile

# Copy des restlichen Quellcodes
COPY . .

# TypeScript kompilieren
RUN pnpm run build

#######################################
# 3) Final Runtime Stage
#######################################
FROM debian:bookworm-slim AS runtime

# Nur die minimalen Laufzeit‑Dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nodejs python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

#######################################
# 3a) Python-Service deployen
#######################################
WORKDIR /opt/deemix-python
COPY --from=python-builder /opt/deemix-python .

#######################################
# 3b) Node-Service deployen
#######################################
WORKDIR /app
# Kompilierten Code und node_modules übernehmen
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package.json ./package.json

# Wenn du noch weitere Skripte brauchst (z.B. run.sh), hierher kopieren:
COPY run.sh .

# Expose Ports wie gewünscht
EXPOSE 8080   # dein TypeScript/Node-Server
EXPOSE 7272   # dein Deemix‑Python‑Server

# Standardbefehl: passe es an dein run.sh oder Entrypoint an
CMD ["sh", "run.sh"]
