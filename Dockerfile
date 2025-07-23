############################
# 1) Frontend-Build-Stage  #
############################
FROM node:18-alpine AS frontend

WORKDIR /app

# 1.1 Nur die Metadaten kopieren + pnpm installieren
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm \
 && pnpm install --frozen-lockfile

# 1.2 Quellcode kopieren und bauen
COPY . .
RUN pnpm run build

############################
# 2) Finales Runtime-Image #
############################
FROM python:3.12-slim

WORKDIR /app

# 2.1 Nur wirklich notwendige System‑Tools für Python‑Dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc \
      libffi-dev \
      pkg-config \
      libssl-dev \
 && rm -rf /var/lib/apt/lists/*

# 2.2 Python‑Dependencies
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install -r python/requirements.txt

# 2.3 Fertige Frontend‑Assets aus dem Node‑Stage übernehmen
COPY --from=frontend /app/dist ./frontend/dist

# 2.4 Restlichen Code
COPY . .

EXPOSE 8080
CMD ["bash", "/app/run.sh"]
