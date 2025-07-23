FROM python:3.12-alpine
WORKDIR /app

# … apk add … libffi-dev pkgconfig …

# Python requirements
COPY python/requirements.txt ./python/
RUN python -m pip install --upgrade pip \
 && python -m pip install -r python/requirements.txt

# Node environment
RUN npm i -g pnpm

# Install package.json deps plus express/axios & types
COPY package.json pnpm-lock.yaml ./
RUN pnpm add express axios \
 && pnpm add -D @types/express @types/node \
 && pnpm install

# Copy source + build
COPY . .
RUN pnpm run build

EXPOSE 8080
CMD ["/app/run.sh"]
