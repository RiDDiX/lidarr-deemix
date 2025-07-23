# ----------------------------
# Stage 1: Build Node/TS app
# ----------------------------
FROM node:18-alpine AS node_builder

WORKDIR /app
# install pnpm and node deps
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm \
 && pnpm install --frozen-lockfile

# compile TS
COPY tsconfig.json tsconfig.tsnode.json src/ ./src
RUN pnpm build

# --------------------------------
# Stage 2: Install Python deps
# --------------------------------
FROM python:3.12-slim AS python_builder

WORKDIR /opt/python
COPY python/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY python/ .

# --------------------------------
# Stage 3: Final runtime image
# --------------------------------
FROM node:18-slim

# install Python runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# copy built Node app
COPY --from=node_builder /app/dist ./dist
COPY --from=node_builder /app/node_modules ./node_modules

# copy Python helper
COPY --from=python_builder /opt/python ./python

# copy orchestrator script
COPY run.sh ./
RUN chmod +x run.sh

# expose both services
EXPOSE 8080   # your TypeScript/Node server
EXPOSE 7272   # Deemix Python server

# start both with your run.sh
CMD ["./run.sh"]
