FROM nginx:1.27-alpine

# Serve the POS UI as a simple static site.
# The UI calls `/api/*` on the same origin, so Dokploy should route `/api` to the backend.

COPY pos-desktop/ui/ /usr/share/nginx/html/

# Default to the unified POS screen.
RUN if [ -f /usr/share/nginx/html/unified.html ]; then cp /usr/share/nginx/html/unified.html /usr/share/nginx/html/index.html; fi

EXPOSE 80

