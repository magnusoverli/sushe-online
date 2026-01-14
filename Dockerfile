# ----- Common base stage -----
# Shared setup for both builder and runtime stages
# This layer is cached and reused, saving ~8-9 seconds per build
FROM node:24-slim AS base

# Update npm to specific version (done once, inherited by both stages)
RUN npm install -g npm@11.7.0 --no-fund

WORKDIR /app

# ----- Build stage -----
FROM base AS builder

# Cache-busting arg - changes with each build to ensure fresh source code
ARG CACHE_BUST=1

# Copy package files and install all dependencies (dev included)
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy the rest of the source and build assets
# The CACHE_BUST arg ensures this layer is never cached
RUN echo "Cache bust: ${CACHE_BUST}"
COPY . .
RUN npm run build

# Remove node_modules before copying to runtime
# Other dev-only files are handled conditionally during COPY
RUN rm -rf node_modules

# ----- Runtime stage -----
FROM base AS runtime

# Build arg to control whether to install dev dependencies (default: production only)
ARG INSTALL_DEV_DEPS=false

# Install only production dependencies  
COPY --chown=node:node package*.json ./

# Add PGDG repository for PostgreSQL 18 client
# Install build-time dependencies, add repo, install pg client, then remove build-time deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man

# Install dependencies - include dev dependencies only if INSTALL_DEV_DEPS=true
RUN if [ "$INSTALL_DEV_DEPS" = "true" ]; then \
      npm ci --prefer-offline --no-audit --no-fund; \
    else \
      npm install --omit=dev --prefer-offline --no-audit --no-fund; \
    fi

# Copy application files and built assets from the builder stage
COPY --chown=node:node --from=builder /app ./

# Clean up files not needed for production (only if not installing dev deps)
# This reduces final image size by ~3MB
RUN if [ "$INSTALL_DEV_DEPS" != "true" ]; then \
      rm -rf test browser-extension .github scripts screenshots .cursor .opencode \
      && rm -f AGENTS.md TESTING.md CHANGELOG.md playwright.config.js \
      && rm -f vite.config.js postcss.config.js tailwind.config.js \
      && rm -f eslint.config.mjs .prettierrc .prettierignore; \
    fi

# Runtime configuration
ENV NODE_ENV=production
RUN mkdir -p /app/data /app/logs && \
    chown node:node /app/data /app/logs

# Node.js runtime optimizations
# - max-old-space-size: V8 heap limit (1GB)
# - enable-source-maps: Better error stack traces in production
# - max-semi-space-size: Larger young generation (64MB) reduces GC pause frequency
# - dns-result-order: Prefer IPv4 to avoid IPv6 fallback delays on external API calls
# - UV_THREADPOOL_SIZE: Increase libuv thread pool for better I/O concurrency
ENV NODE_OPTIONS="--max-old-space-size=1024 --enable-source-maps --max-semi-space-size=64 --dns-result-order=ipv4first"
ENV UV_THREADPOOL_SIZE=8

EXPOSE 3000

# Healthcheck using Node.js (no curl dependency needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

USER node

# Use exec form for better signal handling
CMD ["node", "index.js"]
