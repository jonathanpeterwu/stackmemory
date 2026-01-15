# Railway Optimized Dockerfile - Minimal Dependencies
FROM node:20-slim

# Install dependencies for build
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and use Railway-specific if available
COPY package*.json ./
COPY package.railway.json ./package.railway.json 2>/dev/null || true

# Use Railway package.json if it exists (minimal dependencies)
RUN if [ -f "package.railway.json" ]; then \
      echo "Using Railway-specific package.json"; \
      mv package.railway.json package.json; \
    fi

# Install only production dependencies
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Clean up build dependencies
RUN rm -rf src/ scripts/ test/ tests/ __tests__ *.test.* *.spec.*

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "dist/servers/railway/minimal.js"]