FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (dev included)
COPY package*.json ./
RUN npm ci

# Copy the rest of the source and build assets
COPY . .
RUN npm run build:css

# Remove node_modules so they are not copied to the final image
RUN rm -rf node_modules

FROM node:24-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files and built assets from the builder stage
COPY --from=builder /app ./

# Runtime configuration
ENV NODE_ENV=production
RUN mkdir -p /app/data && \
    chown -R node:node /app/data && \
    chown -R node:node /app

# Node.js optimizations
ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3000

USER node

# Use exec form for better signal handling
CMD ["node", "index.js"]