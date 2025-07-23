# ───────────── Frontend Stage ─────────────
FROM node:18-alpine AS frontend

WORKDIR /app
COPY package.json pnpm-lock.yaml ./

# pnpm installieren und Abhängigkeiten einspielen
RUN npm install -g pnpm \
 && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ─────────── Python Builder Stage ───────────
FROM python:3.12-slim AS builder

WORKDIR /app

# System‑Deps für build
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc libffi-dev pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY deemix-server.py http-redirect-request.py ./

# ───────────── Runtime Stage ─────────────
FROM python:3.12-slim

WORKDIR /app

# Nur ca‑certificates, keine Build‑Tools
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Packages und App kopieren
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /app/deemix-server.py .
COPY --from=builder /app/http-redirect-request.py .
COPY --from=frontend /app/dist ./frontend

# Port 8080 benutzen
EXPOSE 8080

# Server starten
ENTRYPOINT ["waitress-serve", "--port=8080", "deemix-server:app"]
