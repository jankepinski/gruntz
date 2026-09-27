# Gruntz: builds the client and runs the game server, which serves the client too.
#   docker build -t gruntz . && docker run -p 8686:8686 gruntz

FROM node:26-slim AS build
WORKDIR /app
# Node 25+ no longer ships corepack.
RUN npm install -g pnpm@10.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
COPY content content
RUN pnpm --filter @gruntz/client build

FROM node:26-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@10.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
# Only what the server needs at runtime (tsx runs the TypeScript sources directly).
RUN pnpm install --frozen-lockfile --prod --filter @gruntz/server...

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8686
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/core/node_modules packages/core/node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY package.json tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
COPY content content
COPY --from=build /app/apps/client/dist apps/client/dist
USER node
EXPOSE 8686
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
