FROM python:alpine

WORKDIR /app

# Installiere notwendige Pakete und Build-Tools
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

# Kopiere requirements.txt in den Container
COPY python/requirements.txt ./python/requirements.txt

# Installiere Python-Abhängigkeiten
RUN python -m pip install --upgrade pip && \
    python -m pip install --no-cache-dir -r python/requirements.txt

# Installiere pnpm global
RUN npm i -g pnpm

# Kopiere Node-abhängige Dateien und installiere diese
COPY package.json pnpm-lock.yaml ./
RUN pnpm i

# Kopiere den restlichen Code in den Container
COPY . .

EXPOSE 8080

CMD ["/app/run.sh"]
