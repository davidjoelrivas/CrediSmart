# CrediSmart: un solo servicio que atiende la API y la aplicación web.
# Construir:  docker build -t credismart .
# Correr:     docker run -p 3000:3000 --env-file .env -e NODE_ENV=production -e PUBLIC_BASE_URL=https://tu-dominio credismart
FROM node:24-slim

WORKDIR /app
RUN corepack enable

# Primero solo los archivos de dependencias: así Docker reutiliza la instalación si el código cambia.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @app/web build

ENV NODE_ENV=production
EXPOSE 3000
# Se arranca tsx directamente (sin pnpm): el usuario "node" no necesita descargar nada al iniciar.
USER node
WORKDIR /app/apps/api
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
