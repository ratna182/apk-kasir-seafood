import { cache } from 'react'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type GlobalPrisma = typeof globalThis & {
  __prisma?: PrismaClient
}

type CloudflareContext = {
  env?: Record<string, unknown> & {
    HYPERDRIVE?: { connectionString?: string }
  }
}

function getCloudflareContextSafe(): CloudflareContext | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext: (opts?: { async?: boolean }) => CloudflareContext
    }
    return getCloudflareContext({ async: false })
  } catch {
    return undefined
  }
}

function normalizeConnectionString(raw: string): string {
  try {
    const url = new URL(raw)
    if (!url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require')
    }
    if (url.port === '6543' && !url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true')
    }
    return url.toString()
  } catch {
    return raw
  }
}

function getConnectionString(): string | undefined {
  const cfEnv = getCloudflareContextSafe()?.env
  const hyperdrive = cfEnv?.HYPERDRIVE?.connectionString
  if (typeof hyperdrive === 'string' && hyperdrive) return hyperdrive

  const raw =
    (typeof cfEnv?.DIRECT_URL === 'string' && cfEnv.DIRECT_URL) ||
    (typeof cfEnv?.DATABASE_URL === 'string' && cfEnv.DATABASE_URL) ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL
  return raw ? normalizeConnectionString(raw) : undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = getConnectionString()
  const adapter = connectionString
    ? new PrismaPg({ connectionString, maxUses: 1 })
    : undefined
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

const getRequestPrisma = cache(createPrismaClient)

function getPrismaClient(): PrismaClient {
  if (getCloudflareContextSafe()) return getRequestPrisma()

  const globalForPrisma = globalThis as GlobalPrisma
  globalForPrisma.__prisma ??= createPrismaClient()
  return globalForPrisma.__prisma
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient()
    const value = Reflect.get(client, prop)
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
})
