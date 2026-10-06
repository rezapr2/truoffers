# ---- build ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- run ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Uploaded files live on a volume mounted here; it must belong to the user the API runs as.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 4000
CMD ["node", "dist/main"]
