FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/admin/package.json apps/admin/package-lock.json /app/
RUN npm ci

COPY apps/admin /app/

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
