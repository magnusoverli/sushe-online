# ----- Build stage -----
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files and install all dependencies (dev included)
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    npm ci --prefer-offline --no-audit && \
    apt-get purge -y --auto-remove python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy the rest of the source and build assets
COPY . .
RUN npm run build

# Remove development dependencies but keep already built modules
RUN npm prune --omit=dev

# ----- Runtime stage -----
FROM node:22-slim AS runtime

WORKDIR /app


# Copy application files and built assets from the builder stage
COPY --chown=node:node --from=builder /app ./

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Runtime configuration
ENV NODE_ENV=production
RUN mkdir -p /app/data && \
    chown node:node /app/data

# Node.js optimizations
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

USER node

# Use exec form for better signal handling
CMD ["node", "index.js"]
