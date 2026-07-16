# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Empty VITE_PROXY_URL bakes in same-origin relative fetches (e.g. /proxmox, /zabbix)
# rather than the http://localhost:3001 dev fallback — nginx below reverse-proxies
# those paths to the proxy container, so the browser only ever talks to one origin.
RUN echo "VITE_PROXY_URL=" > .env.production

RUN npm run build

# --- Serve stage ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
