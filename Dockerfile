# Base image: Debian slim with Python 3.12
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# System dependencies: build tools, libffi, pkg-config, SSL, curl, bash
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      libffi-dev \
      pkg-config \
      libssl-dev \
      curl \
      bash \
 && rm -rf /var/lib/apt/lists/*

# Copy and install Python requirements
COPY python/requirements.txt ./python/
RUN python -m pip install --upgrade pip \
 && python -m pip install -r python/requirements.txt

# Install pnpm globally
RUN npm install -g pnpm

# Copy Node project manifests and install dependencies
COPY package.json pnpm-lock.yaml ./
# Add Express & Axios and their types, then install all deps
RUN pnpm add express axios \
 && pnpm add -D @types/express @types/node \
 && pnpm install

# Copy remaining source code and build
COPY . .
RUN pnpm run build

# Expose the application port
EXPOSE 8080

# Default startup script
CMD ["/app/run.sh"]