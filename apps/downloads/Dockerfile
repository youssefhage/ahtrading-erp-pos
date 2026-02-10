FROM nginx:alpine

# Static download page; update artifacts are served from /updates via a Docker volume
# (so we can upload new installers without rebuilding the image).

COPY apps/downloads/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/downloads/public/ /usr/share/nginx/html/
