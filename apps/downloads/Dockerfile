FROM nginx:alpine

# Downloads host: pure reverse proxy to the API service.
# All content (landing page, installers, update JSON) is served by the API
# from the shared /updates volume. This container only provides nginx routing.

# Seed the volume structure for first run.
RUN mkdir -p /updates/pos /updates/portal /updates/site

COPY apps/downloads/nginx.conf /etc/nginx/conf.d/default.conf
