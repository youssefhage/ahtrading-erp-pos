FROM nginx:alpine

# Downloads host:
# - Serves the landing page + static assets (favicon, icons).
# - Proxies /updates/* to the API which reads from the shared /updates volume.
# - Prefer serving the landing page from /updates/site (written by the API) so
#   UI changes don't depend on rebuilding this container.

# Create initial structure so Docker named volume gets these folders on first run.
# (Docker copies existing dir contents into an empty named volume on initial mount.)
RUN mkdir -p /updates/pos /updates/portal /updates/setup /updates/site \
  && printf "%s\n" "Upload artifacts for POS Desktop here." > /updates/pos/README.txt \
  && printf "%s\n" "Upload artifacts for Admin Desktop here. (Legacy path: portal)" > /updates/portal/README.txt \
  && printf "%s\n" "Upload artifacts for Setup Desktop here." > /updates/setup/README.txt \
  && printf "%s\n" "Downloads landing page (index.html + style.css) written by the API." > /updates/site/README.txt

COPY apps/downloads/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/downloads/public/ /usr/share/nginx/html/
