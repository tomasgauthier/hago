# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

# better-sqlite3 needs the binary, so we copy node_modules or reinstall prod
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

ENV DATA_DIR=/app/data
ENV SERVER_HOST=127.0.0.1
VOLUME /app/data

CMD ["node", "dist/index.js"]
