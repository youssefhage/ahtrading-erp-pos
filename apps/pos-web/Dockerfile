FROM node:20-alpine AS build

WORKDIR /app
COPY pos-desktop/ui/package*.json ./ui/
RUN cd ui && npm ci
COPY pos-desktop/ui ./ui
WORKDIR /app/ui
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/ui/dist /usr/share/nginx/html/
RUN cp /usr/share/nginx/html/index.html /usr/share/nginx/html/unified.html
COPY apps/pos-web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
