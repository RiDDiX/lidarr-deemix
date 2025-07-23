FROM python:3.11-alpine

WORKDIR /app

# Install all dependencies
RUN apk add --no-cache nodejs npm curl rust cargo build-base openssl-dev bsd-compat-headers bash

# Python requirements
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install -r python/requirements.txt

# Node.js requirements
RUN npm i -g pnpm

# Copy node files
COPY package.json pnpm-lock.yaml ./

RUN pnpm install

# Copy source code
COPY . .

# Build TS to JS
RUN pnpm run build

EXPOSE 8080

CMD ["/app/run.sh"]
