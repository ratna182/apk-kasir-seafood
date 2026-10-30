#!/bin/bash
set -e

# Run pending migrations in production only.
# Preview deployments have no DATABASE_URL, so migrations are skipped there.
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  echo "Preview deployment detected, skipping prisma migrate deploy."
else
  prisma migrate deploy
fi

# Generate Prisma Client
prisma generate

# Build Next.js
next build
