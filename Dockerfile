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

COPY python/requirements.txt python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir -r python/requirements.txt

RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

RUN pnpm run build

RUN chmod +x ./run.sh

EXPOSE 8080

CMD ["./run.sh"]