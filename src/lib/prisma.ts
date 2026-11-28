import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type GlobalPrisma = typeof globalThis & {
  __prisma?: PrismaClient
}

type CloudflareContext = {
  env?: Record<string, unknown> & {
    HYPERDRIVE?: { connectionString?: string }
  }
  ctx?: object
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
  if (!connectionString) {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  }

  const pool = new Pool({
    connectionString,
    max: 5,
    allowExitOnIdle: true,
  })

  const adapter = new PrismaPg(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

const requestClients = new WeakMap<object, PrismaClient>()

function getPrismaClient(): PrismaClient {
  const ctx = getCloudflareContextSafe()?.ctx
  if (ctx) {
    let client = requestClients.get(ctx)
    if (!client) {
      client = createPrismaClient()
      requestClients.set(ctx, client)
    }
    return client
  }

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

