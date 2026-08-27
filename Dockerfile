# Multi-stage Dockerfile for MapOS V3

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/layer-sdk/package.json packages/layer-sdk/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --workspace=@mapos/layer-sdk --workspace=@mapos/api --workspace=@mapos/web 2>/dev/null || npm install

COPY tsconfig.base.json ./
COPY packages/layer-sdk packages/layer-sdk
COPY apps/api apps/api
COPY apps/web apps/web

RUN npm run build -w @mapos/layer-sdk

# --- API ---
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/tsconfig.base.json ./
COPY --from=base /app/packages/layer-sdk ./packages/layer-sdk
COPY --from=base /app/apps/api ./apps/api
RUN npm run build -w @mapos/api
EXPOSE 4033
CMD ["node", "apps/api/dist/index.js"]

# --- Web ---
FROM node:22-alpine AS web-build
WORKDIR /app
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY --from=base /app ./
RUN npm run build -w @mapos/web

FROM nginx:alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 4032
