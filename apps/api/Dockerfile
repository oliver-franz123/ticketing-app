# Imagen de la API (T3, doc 07). El contexto de build es la RAÍZ del monorepo:
#   docker build -f apps/api/Dockerfile -t entradas-api .
# glibc (bookworm) y no alpine: los binarios precompilados de argon2 se prueban
# sobre todo en glibc. Las migraciones NO corren aquí: van en CI antes del
# deploy (doc 07 §7), así que la imagen no lleva el CLI de Prisma.

FROM node:22-bookworm-slim AS base
WORKDIR /app

# Manifiestos de TODOS los workspaces: npm ci compara contra el lockfile y
# falla si falta alguno, aunque la api no use web ni worker.
FROM base AS manifiestos
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

FROM manifiestos AS build
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
# prisma.config.ts exige DIRECT_URL aunque generate no se conecte: valor de
# relleno, no es un secreto y no llega a la imagen final.
ENV DIRECT_URL=postgresql://build:build@localhost:5432/build
# Mismo orden que el build de la raíz: shared → db (generate + tsc) → api.
RUN npm run build -w @entradas/shared -w @entradas/db -w @entradas/api

# Solo las dependencias de runtime de la api (y los symlinks a db y shared).
# --omit=optional también: el CLI de prisma (y typescript, effect...) figura
# como devOptional en el lockfile (dev en db + peer opcional de @prisma/client)
# y --omit=dev solo no lo saca. Los opcionales que no son de dev son de Next
# (sharp, swc) y pg-cloudflare: ninguno hace falta en la api.
FROM manifiestos AS deps-prod
RUN npm ci --omit=dev --omit=optional -w @entradas/api && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production TZ=UTC
COPY --from=deps-prod /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
