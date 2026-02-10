FROM nginx:alpine

# Static download page; update artifacts are served from /updates via a Docker volume
# (so we can upload new installers without rebuilding the image).

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
