FROM python:3.12-alpine

WORKDIR /app

# 1) System‑Deps
RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    build-base \
    openssl-dev \
    libffi-dev

# 2) Python‑Deps
COPY python/requirements.txt python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir -r python/requirements.txt

# 3) pnpm + Node‑Deps
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# 4) Quellcode kopieren
COPY . .

# 5) run.sh ausführbar machen
RUN chmod +x ./run.sh

# 6) Ports freigeben
EXPOSE 7272 8080

# 7) Start
CMD ["./run.sh"]
