# ----- Build stage -----
FROM node:24-slim AS builder

# Update npm to specific version
RUN npm install -g npm@11.6.1 --no-fund

WORKDIR /app

# Copy package files and install all dependencies (dev included)
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy the rest of the source and build assets
COPY . .
RUN npm run build

# Remove node_modules so they are not copied to the final image
RUN rm -rf node_modules

# ----- Runtime stage -----
FROM node:24-slim AS runtime

# Update npm to specific version
RUN npm install -g npm@11.6.1 --no-fund

WORKDIR /app

# Install only production dependencies  
COPY --chown=node:node package*.json ./

# Add PGDG repository for PostgreSQL 18 client
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --omit=dev --prefer-offline --no-audit --no-fund

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
