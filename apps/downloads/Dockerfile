FROM nginx:alpine

# Static download page; update artifacts are served from /updates via a Docker volume
# (so we can upload new installers without rebuilding the image).

# Create initial structure so Docker named volume gets these folders on first run.
# (Docker copies existing dir contents into an empty named volume on initial mount.)
RUN mkdir -p /updates/pos /updates/portal \
  && printf "%s\n" "Upload artifacts for POS Desktop here." > /updates/pos/README.txt \
  && printf "%s\n" "Upload artifacts for Portal Desktop here." > /updates/portal/README.txt

COPY apps/downloads/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/downloads/public/ /usr/share/nginx/html/
