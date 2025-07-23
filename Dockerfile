FROM node:20-alpine AS builder

WORKDIR /app
RUN apk add --no-cache build-base python3-dev

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install

COPY tsconfig*.json ./
COPY src ./src
RUN pnpm build

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/package.json /app/dist /app/node_modules ./
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
