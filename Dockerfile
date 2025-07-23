FROM python:3.12-alpine

WORKDIR /app

# 1) System‑Deps: Python/C build tools + Node.js
RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    build-base \
    openssl-dev \
    libffi-dev \
    pkgconf \
    python3-dev

# 2) Python‑Deps
COPY python/requirements.txt python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir -r python/requirements.txt

# 3) pnpm & Node‑Deps
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# 4) Copy all code & build TS
COPY . .
RUN pnpm run build

# 5) Make entrypoint executable
RUN chmod +x ./run.sh

# 6) Expose ports
EXPOSE 8080

# 7) Start all services
CMD ["./run.sh"]