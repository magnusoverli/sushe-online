FROM node:24-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev) for the build
# Don't set NODE_ENV yet so we get devDependencies
RUN npm ci

# Copy source files
COPY . .

# Build CSS (needs devDependencies)
RUN npm run build:css

# NOW set production environment and remove dev dependencies
ENV NODE_ENV=production
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