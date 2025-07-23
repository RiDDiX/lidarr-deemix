# Basis-Image
FROM python:3.12-slim

# Arbeitsverzeichnis
WORKDIR /app

# System‑Packages (inkl. Node.js und npm für pnpm)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      libffi-dev \
      pkg-config \
      libssl-dev \
      curl \
      bash \
      nodejs \
      npm \
 && rm -rf /var/lib/apt/lists/*

# Python‑Abhängigkeiten installieren
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install -r python/requirements.txt

# pnpm global installieren
RUN npm install -g pnpm

# Node‑Projekt‑Manifeste und Abhängigkeiten
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Rest des Projekts kopieren und bauen
COPY . .
RUN pnpm run build

# Ports und Startbefehl
EXPOSE 8080
CMD ["bash", "/app/run.sh"]