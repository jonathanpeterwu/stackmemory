# Railway Optimized Dockerfile - Force rebuild v2
FROM node:20-slim

# Install dependencies for build
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (using install instead of ci for flexibility)
RUN npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Clean up build dependencies and unnecessary files
RUN rm -rf src/ scripts/ test/ tests/ __tests__ *.test.* *.spec.* node_modules/.cache

# Expose port (Railway uses PORT env var)
EXPOSE 3000

# Ensure minimal.js doesn't exist and start FULL server
RUN rm -f dist/servers/railway/minimal.js dist/servers/railway/minimal.js.map || true

# Start the FULL server with authentication endpoints
CMD ["node", "dist/servers/railway/index.js"]