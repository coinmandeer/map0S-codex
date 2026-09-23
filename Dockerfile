# Multi-stage Dockerfile for MapOS V3

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/layer-sdk/package.json packages/layer-sdk/
COPY packages/adapter-sdk/package.json packages/adapter-sdk/
COPY packages/map-runtime/package.json packages/map-runtime/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=@mapos/layer-sdk --workspace=@mapos/adapter-sdk --workspace=@mapos/map-runtime --workspace=@mapos/api --workspace=@mapos/web

COPY tsconfig.base.json ./
COPY packages/layer-sdk packages/layer-sdk
COPY packages/adapter-sdk packages/adapter-sdk
COPY packages/map-runtime packages/map-runtime
COPY apps/api apps/api
COPY apps/web apps/web

RUN npm run build -w @mapos/layer-sdk
RUN npm run build -w @mapos/adapter-sdk
RUN npm run build -w @mapos/map-runtime

# --- API ---
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/tsconfig.base.json ./
COPY --from=base /app/packages/layer-sdk ./packages/layer-sdk
COPY --from=base /app/packages/adapter-sdk ./packages/adapter-sdk
COPY --from=base /app/apps/api ./apps/api
COPY scripts/copy-ai-assets.mjs ./scripts/copy-ai-assets.mjs
RUN npm run build -w @mapos/api
EXPOSE 4033
CMD ["node", "apps/api/dist/index.js"]

# --- Web ---
FROM node:22-alpine AS web-build
WORKDIR /app
ARG MAPOS_RELEASE=development
ENV MAPOS_RELEASE=$MAPOS_RELEASE
ARG VITE_API_BASE_URL=/api
ARG VITE_MAP_RUNTIME_V2=
ARG VITE_DISCOVER_BOUNDARIES=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_MAP_RUNTIME_V2=$VITE_MAP_RUNTIME_V2
ENV VITE_DISCOVER_BOUNDARIES=$VITE_DISCOVER_BOUNDARIES
COPY --from=base /app ./
RUN npm run build -w @mapos/web

FROM nginx:alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/security-headers.inc /etc/nginx/security-headers.inc
EXPOSE 4032
