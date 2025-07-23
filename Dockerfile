FROM python:3.12-alpine

WORKDIR /app

RUN apk add --no-cache \
      bash build-base curl openssl-dev libffi-dev pkgconf python3-dev \
      nodejs npm

# Python
COPY python/requirements.txt python/requirements.txt
RUN python3 -m pip install --upgrade pip && \
    python3 -m pip install --no-cache-dir -r python/requirements.txt

# Node / TS
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY . .
RUN pnpm build

# Nur den MITM‑Proxy dokumentieren
EXPOSE 8080

RUN chmod +x run.sh
CMD ["./run.sh"]
