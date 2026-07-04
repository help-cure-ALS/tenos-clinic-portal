# ---------- build stage ----------
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# Vite env vars must be available at build time
ARG VITE_MEDPLUM_URL=/api
ARG VITE_MEDPLUM_CLIENT_ID
ARG VITE_MEDPLUM_PROJECT_ID
ARG VITE_VERIFICATION_API_URL=/vapi

RUN bun run build

# ---------- production stage ----------
FROM caddy:2-alpine

COPY --from=build /app/dist /srv/app
COPY Caddyfile.prod /etc/caddy/Caddyfile

EXPOSE 80
