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

# Installiere nur die notwendigen Laufzeit-Tools (inkl. dos2unix zur Sicherheit)
RUN apk add --no-cache nodejs mitmproxy bash dos2unix

# --- Kopiere Abhängigkeiten aus der Builder-Stufe ---
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /app/node_modules ./node_modules

# --- Kopiere Anwendungs-Code ---
COPY --from=builder /app/dist ./dist
COPY python ./python
COPY run.sh .

# === ENTSCHEIDENDER FIX FÜR DEN STARTFEHLER ===
# Stelle sicher, dass das Skript Unix-Zeilenenden hat und ausführbar ist
RUN dos2unix ./run.sh && chmod +x ./run.sh

# Exponiere den Port des Proxys
EXPOSE 8080

# Starte die Anwendung
CMD ["/app/run.sh"]