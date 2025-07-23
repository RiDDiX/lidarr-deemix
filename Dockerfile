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

# Python dependencies
COPY python/requirements.txt python/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir -r python/requirements.txt

# pnpm and Node.js dependencies
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Copy application code
COPY . .

# Build TypeScript
RUN pnpm run build

# Make run.sh executable
RUN chmod +x ./run.sh

# Expose ports
EXPOSE 7272 8080

# Start all services
CMD ["./run.sh"]