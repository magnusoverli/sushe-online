FROM node:24-alpine

# Set production environment - CRITICAL for performance
ENV NODE_ENV=production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev) for the build
RUN npm ci

# Copy source files
COPY . .

# Build CSS
RUN npm run build:css

# Remove dev dependencies after build
RUN npm prune --production

# Create data directory and set permissions
RUN mkdir -p /app/data && \
    chown -R node:node /app/data && \
    chown -R node:node /app

# Node.js optimizations
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

USER node

# Use exec form for better signal handling
CMD ["node", "index.js"]