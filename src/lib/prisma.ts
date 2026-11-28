import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type GlobalPrisma = typeof globalThis & {
  __prisma?: PrismaClient
}

type CloudflareContext = {
  ctx?: object
  env?: Record<string, unknown>
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
    if (url.port === '6543' && !url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1')
    }
    return url.toString()
  } catch {
    return raw
  }
}

function getConnectionString(): string | undefined {
  const cfEnv = getCloudflareContextSafe()?.env
  const raw =
    (typeof cfEnv?.DATABASE_URL === 'string' && cfEnv.DATABASE_URL) ||
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

  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

const requestClients = new WeakMap<object, PrismaClient>()

function getPrismaClient(): PrismaClient {
  const ctx = getCloudflareContextSafe()?.ctx
  if (ctx) {
    const cached = requestClients.get(ctx)
    if (cached) return cached
    const client = createPrismaClient()
    requestClients.set(ctx, client)
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

