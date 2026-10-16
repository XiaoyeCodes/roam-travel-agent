FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --from=build --chown=node:node /app/package*.json ./
RUN mkdir -p /app/.data && chown node:node /app/.data
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 BROWSER_EXECUTABLE_PATH=/usr/bin/chromium PDF_NO_SANDBOX=1
USER node
EXPOSE 8787
CMD ["node", "server/dist/server/src/index.js"]
