# ----- Build stage -----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (dev included)
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit

# Copy the rest of the source and build assets
COPY . .
RUN npm run build

# Remove node_modules so they are not copied to the final image
RUN rm -rf node_modules

# ----- Runtime stage -----
FROM node:22-alpine AS runtime

WORKDIR /app

# Install only production dependencies
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit \
    && apk add --no-cache curl postgresql16-client

# Copy application files and built assets from the builder stage
COPY --chown=node:node --from=builder /app ./

# Runtime configuration
ENV NODE_ENV=production
RUN mkdir -p /app/data /app/logs && \
    chown node:node /app/data /app/logs

# Node.js optimizations
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

USER node

# Use exec form for better signal handling
CMD ["node", "index.js"]
