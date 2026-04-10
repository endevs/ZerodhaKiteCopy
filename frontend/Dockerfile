# Build CRA, serve with Nginx; proxies /api and /socket.io to backend:8003
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Same-origin in browser: empty = relative URLs to this host (Nginx)
ARG REACT_APP_API_BASE=
ARG REACT_APP_SOCKET_BASE=
ENV REACT_APP_API_BASE=$REACT_APP_API_BASE \
    REACT_APP_SOCKET_BASE=$REACT_APP_SOCKET_BASE

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
