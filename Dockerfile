FROM python:3.12-alpine

WORKDIR /app

# Alpine‑Packages für Node, Build‑Tools und libffi
RUN apk add --no-cache \
      nodejs npm curl \
      rust cargo build-base \
      openssl-dev bsd-compat-headers bash \
      libffi-dev pkgconfig

# Python‑Requirements
COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install -r python/requirements.txt

# Node‑Env
RUN npm i -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm i
COPY . .
RUN pnpm run build

EXPOSE 8080
CMD ["/app/run.sh"]
