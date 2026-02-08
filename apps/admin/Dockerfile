FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/admin/package.json apps/admin/package-lock.json /app/
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 120000
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY apps/admin /app/

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
