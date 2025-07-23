# 1) Basis-Image mit Python + Alpine
FROM python:3.12-alpine

# 2) Arbeitsverzeichnis
WORKDIR /app

# 3) System‑Pakete installieren
RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    build-base \
    openssl-dev \
    libffi-dev

# 4) Python‑Dependencies
COPY python/requirements.txt python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir -r python/requirements.txt

# 5) pnpm installieren und Node‑Dependencies
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# 6) Quellcode kopieren
COPY . .

# 7) TypeScript bauen (für pnpm run start)
#    Hier muss dein "build"-Script in package.json existieren, z.B. "build": "tsc"
RUN pnpm build

# 8) run.sh ausführbar machen
RUN chmod +x ./run.sh

# 9) Ports freigeben
#    7272 = Python/Deemix-Server
#    8080 = Node/TS-Proxy
#    8081 = ggf. mitmdump (je nach Konfiguration)
EXPOSE 7272 8080 8081

# 10) Default EntryPoint
CMD ["./run.sh"]
