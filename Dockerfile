#######################################
# 1) Node‑Builder Stage
#######################################
FROM node:18-alpine AS node-builder

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@8 \
  && pnpm install --no-frozen-lockfile \
  && pnpm run build

#######################################
# 2) Python‑Builder Stage (unchanged)
#######################################
FROM python:3.12-slim AS python-builder
# … wie gehabt …

#######################################
# 3) Final Runtime Stage
#######################################
FROM debian:bookworm-slim AS runtime

# … deine Runtime‑Schritte …

# **WICHTIG**: Hier FROM‑Angaben anpassen
COPY --from=node-builder /app/dist    ./dist
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package.json  ./package.json

# 6) Dein Start‑Skript
COPY run.sh .
RUN chmod +x run.sh

# Ports
EXPOSE 8080

# EntryPoint
CMD ["./run.sh"]
