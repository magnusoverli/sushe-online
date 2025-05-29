# Use Node.js LTS version
FROM node:22-alpine

# Verify the Node.js version:
node -v # Should print "v22.16.0".
# Verify npm version:
npm -v # Should print "10.9.2".

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy the rest of the application
COPY . .

# Build CSS (since you're using Tailwind)
RUN npm install -D tailwindcss postcss postcss-cli autoprefixer
RUN npm run build:css

# Clean up dev dependencies
RUN npm prune --production

# Create a directory for data persistence and set permissions
RUN mkdir -p /app/data && \
    chown -R node:node /app/data && \
    chown -R node:node /app

# Expose the port your app runs on
EXPOSE 3000

# Use node user (security best practice)
USER node

# Start the application
CMD ["node", "index.js"]