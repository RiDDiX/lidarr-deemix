# Dockerfile
FROM python:3.12-alpine

WORKDIR /app

RUN apk add --no-cache \
    nodejs \
    npm \
    bash \
    curl \
    build-base \
    openssl-dev \
    libffi-dev

# Python‑Dependencies
COPY python/requirements.txt python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir -r python/requirements.txt

# Node‑Dependencies
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Quellcode
COPY . .

# build TypeScript
RUN pnpm run build

# make run.sh executable
RUN chmod +x ./run.sh

EXPOSE 7272 8080

CMD ["./run.sh"]
