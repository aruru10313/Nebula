FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY server.js ./
COPY scripts ./scripts
COPY src ./src
RUN npx prisma generate && npm run build:admin

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/server.js ./
COPY --from=build /app/admin-dist ./admin-dist
USER node
EXPOSE 3001
CMD ["node", "server.js"]
