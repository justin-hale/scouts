# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    ROMSAFE_PORT=8080 \
    ROMSAFE_DATA_DIR=/data \
    ROMSAFE_PROFILES_DIR=/app/profiles \
    ROMSAFE_WEB_DIR=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY profiles profiles
RUN mkdir -p /data && chown node:node /data
# Runs as uid 1000 by default; override with `user:` in compose to match
# the owner of your ROM and save folders.
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.ROMSAFE_PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
