FROM node:20-alpine AS builder
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --only=production
FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
COPY --from=builder /usr/bin/dumb-init /usr/bin/dumb-init
WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs app/ ./
USER nodejs
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]