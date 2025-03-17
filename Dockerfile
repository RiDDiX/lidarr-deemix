FROM python:3.12-alpine

WORKDIR /app

# Installiere grundlegende Build-Tools und Bibliotheken
RUN apk add --no-cache \
    nodejs \
    npm \
    curl \
    rust \
    cargo \
    build-base \
    openssl-dev \
    bsd-compat-headers \
    bash \
    gcc \
    musl-dev \
    libffi-dev

# Kopiere die requirements.txt in den Container
COPY python/requirements.txt ./python/requirements.txt

# Upgrade pip und installiere Python-Abhängigkeiten ohne Cache
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r python/requirements.txt

# Installiere pnpm global
RUN npm i -g pnpm

# Kopiere package.json und pnpm-lock.yaml und installiere Node-Abhängigkeiten
COPY package.json pnpm-lock.yaml ./
RUN pnpm i

# Kopiere den restlichen Quellcode in den Container
COPY . .

EXPOSE 8080

CMD ["/app/run.sh"]
