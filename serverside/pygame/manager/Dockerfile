FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY manager.js ./
COPY config/ ./config/

# Create generated files directory
RUN mkdir -p /tmp/pygame-generated

# Environment
ENV NODE_ENV=production
ENV NODE_CONFIG_DIR=/app/config

# Expose port
EXPOSE 8100

CMD ["node", "manager.js"]
