# Scam Shield frontend image (multi-stage: Vite build -> nginx).
# Build:  docker build -t scam-shield-frontend ./frontend
# nginx serves the static bundle and proxies /api/* -> backend:8000 (same
# behavior as the Vite dev proxy).

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Keep same-origin /api calls by default (nginx proxies them). Override with
# --build-arg VITE_API_BASE=https://your-backend.example if you want the
# bundle to call a remote backend directly.
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80