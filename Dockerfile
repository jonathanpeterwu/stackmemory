# Railway Optimized Dockerfile
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
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Clean up build dependencies and unnecessary files
RUN rm -rf src/ scripts/ test/ tests/ __tests__ *.test.* *.spec.* node_modules/.cache

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]