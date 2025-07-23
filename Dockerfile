# ┌───────────────────────────────────────
# │ Stage 1: Build the Node/TS app
# └───────────────────────────────────────
FROM node:18-alpine AS node_builder

WORKDIR /app

# install the pnpm version matching your lockfile
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@8 \
 && pnpm install --frozen-lockfile

# compile TypeScript into /app/dist
COPY tsconfig.json tsconfig.tsnode.json src/ ./src/
RUN pnpm build


# ┌───────────────────────────────────────
# │ Stage 2: Install Python deps
# └───────────────────────────────────────
FROM python:3.12-slim AS python_builder

WORKDIR /opt/deemix-python

COPY python/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# copy your server scripts
COPY python/ .


# ┌───────────────────────────────────────
# │ Stage 3: Final runtime image
# └───────────────────────────────────────
FROM debian:bookworm-slim

# get a minimal Node.js + Python3 runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nodejs npm \
      python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# bring in built Node app
COPY --from=node_builder /app/dist ./dist
COPY --from=node_builder /app/node_modules ./node_modules

# bring in your Python helper
COPY --from=python_builder /opt/deemix-python ./deemix-python

# your launcher script
COPY run.sh ./
RUN chmod +x run.sh

# only these two ports are exposed—
# 8080 for your TS/Node API
EXPOSE 8080


# spin up both services
CMD ["./run.sh"]
