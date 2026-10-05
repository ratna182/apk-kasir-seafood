#!/bin/bash
set -e

# Run all pending migrations
prisma migrate deploy

# Generate Prisma Client
prisma generate

# Build Next.js
next build