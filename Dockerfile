# =================
#  Stufe 1: Builder
# =================
# Hier installieren wir alle Abhängigkeiten und bauen die Anwendung
FROM python:3.12-alpine AS builder

WORKDIR /app

# Installiere Build-Tools (inkl. openssl-dev)
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
# Korrigierter und zusammengefügter Befehl
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r python/requirements.txt

# --- Node.js Abhängigkeiten ---
COPY package.json pnpm-lock.yaml ./
RUN pnpm i

# Kopiere den gesamten Quellcode
COPY . .

# Kompiliere den TypeScript-Code nach JavaScript
RUN pnpm tsc

# =================
#  Stufe 2: Finales Image
# =================
# Dieses Image enthält nur das, was zum Ausführen benötigt wird
FROM python:3.12-alpine

WORKDIR /app

# Installiere nur die notwendigen Laufzeit-Tools
RUN apk add --no-cache nodejs mitmproxy bash

# --- Kopiere Abhängigkeiten aus der Builder-Stufe ---
# Kopiere installierte Python-Pakete
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
# Kopiere installierte Node-Module
COPY --from=builder /app/node_modules ./node_modules

# --- Kopiere Anwendungs-Code ---
# Kopiere den kompilierten JavaScript-Code
COPY --from=builder /app/dist ./dist
# Kopiere die Python-Skripte
COPY python ./python
# Kopiere das Start-Skript
COPY run.sh .

# Mache das Start-Skript ausführbar
RUN chmod +x ./run.sh

# Exponiere den Port des Proxys
EXPOSE 8080

# Starte die Anwendung
CMD ["/app/run.sh"]