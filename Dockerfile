FROM python:alpine

WORKDIR /app

# Systemtools + Build Deps + libffi-dev!
RUN apk add --no-cache nodejs npm curl rust cargo build-base openssl-dev bsd-compat-headers bash libffi-dev

COPY python/requirements.txt ./python/requirements.txt
RUN python -m pip install -r python/requirements.txt

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

CMD ["node", "dist/index.js"]
