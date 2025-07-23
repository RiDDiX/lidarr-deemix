#######################################
# 3) Final Runtime Stage
#######################################
FROM debian:bookworm-slim AS runtime

# 1) Grundsystem + Node.js + Python3 + npm + pip3 installieren
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      nodejs npm \
      python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

# 2) 'python' → 'python3' Symlink, damit "python" verfügbar ist
RUN ln -s /usr/bin/python3 /usr/bin/python

# 3) Python‑Dependencies installieren (inkl. mitmproxy & waitress usw.)
#    wir kopieren nur requirements.txt aus dem python‑Ordner
WORKDIR /opt/deemix-python
COPY python/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# 4) Deemix‑Service‑Quellcode
COPY python/ .

# 5) Node‑App deployen: kopiere bereits gebauten Output + node_modules
WORKDIR /app
COPY --from=node-builder /app/dist ./dist
COPY --from=node-builder /app/node_modules ./node_modules
# optional: falls du Umgebungs‑Variablen in package.json brauchst
COPY --from=node-builder /app/package.json ./package.json

# 6) Dein Start‑Skript
COPY run.sh .
RUN chmod +x run.sh

# Ports
EXPOSE 8080

# EntryPoint
CMD ["./run.sh"]
