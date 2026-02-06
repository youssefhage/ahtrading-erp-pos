FROM node:20-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/admin/package.json /app/package.json
COPY apps/admin/tsconfig.json /app/tsconfig.json
COPY apps/admin/next.config.js /app/next.config.js
COPY apps/admin/postcss.config.js /app/postcss.config.js
COPY apps/admin/tailwind.config.ts /app/tailwind.config.ts
COPY apps/admin/next-env.d.ts /app/next-env.d.ts

RUN npm install

COPY apps/admin /app

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]

