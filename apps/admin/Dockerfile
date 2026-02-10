FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Build-time config (Next.js inlines NEXT_PUBLIC_* variables).
ARG NEXT_PUBLIC_API_BASE_URL=/mapi
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# Optional: server-side rewrite target for same-origin /api proxy.
ARG API_PROXY_TARGET=http://api:8000
ENV API_PROXY_TARGET=$API_PROXY_TARGET

COPY apps/admin/package.json apps/admin/package-lock.json /app/
RUN npm ci

COPY apps/admin /app/

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
