import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type GlobalPrisma = typeof globalThis & {
  __prisma?: PrismaClient
  __prismaPool?: Pool
}

type HyperdriveBinding = {
  connectionString: string
}

type CloudflareContext = {
  env?: Record<string, unknown> & {
    HYPERDRIVE?: HyperdriveBinding
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

  // Fallback for non-Hyperdrive environments.
  const raw =
    (typeof cfEnv?.DIRECT_URL === 'string' && cfEnv.DIRECT_URL) ||
    (typeof cfEnv?.DATABASE_URL === 'string' && cfEnv.DATABASE_URL) ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL
  return raw ? normalizeConnectionString(raw) : undefined
}

const CONNECTION_ERROR_PATTERNS = [
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Connection ended unexpectedly',
  'terminating connection',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'socket hang up',
]

function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return CONNECTION_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

async function resetPrismaClient(): Promise<void> {
  const globalForPrisma = globalThis as GlobalPrisma
  const client = globalForPrisma.__prisma
  const pool = globalForPrisma.__prismaPool
  globalForPrisma.__prisma = undefined
  globalForPrisma.__prismaPool = undefined
  void client?.$disconnect().catch(() => {})
  void pool?.end().catch(() => {})
}

function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  pool.on('error', (err) => {
    console.error('[prisma] idle pg client error', err.message)
  })
  return pool
}

function getPool(connectionString: string): Pool {
  const globalForPrisma = globalThis as GlobalPrisma
  globalForPrisma.__prismaPool ??= createPool(connectionString)
  return globalForPrisma.__prismaPool
}

function createPrismaClient(): PrismaClient {
  const connectionString = getConnectionString()
  if (!connectionString) {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  }

  const adapter = new PrismaPg(getPool(connectionString), {
    onPoolError: (err) => console.error('[prisma] pool error', err.message),
    onConnectionError: (err) => console.error('[prisma] connection error', err.message),
  })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

function getPrismaClient(): PrismaClient {
  const globalForPrisma = globalThis as GlobalPrisma
  globalForPrisma.__prisma ??= createPrismaClient()
  return globalForPrisma.__prisma
}

function resolvePath(path: Array<string | symbol>): { owner: unknown; leaf: unknown } {
  let owner: unknown = getPrismaClient()
  for (let i = 0; i < path.length - 1; i++) {
    owner = (owner as Record<string | symbol, unknown>)[path[i]]
  }
  const leafKey = path[path.length - 1]
  const leaf = leafKey === undefined ? owner : Reflect.get(owner as object, leafKey)
  return { owner, leaf }
}

function wrapPrismaValue(value: unknown, path: Array<string | symbol>): unknown {
  if (typeof value === 'function') {
    return (...args: unknown[]) => {
      const invoke = () => {
        const { owner, leaf } = resolvePath(path)
        return (leaf as (...inner: unknown[]) => unknown).apply(owner, args)
      }
      try {
        const result = invoke()
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).catch(async (error) => {
            if (!isConnectionError(error)) throw error
            console.warn('[prisma] connection error, resetting client and retrying once')
            await resetPrismaClient()
            return invoke() as Promise<unknown>
          })
        }
        return result
      } catch (error) {
        throw error
      }
    }
  }

  if (value && typeof value === 'object') {
    return new Proxy(value as object, {
      get(target, prop) {
        const nextPath = [...path, prop]
        return wrapPrismaValue(Reflect.get(target, prop), nextPath)
      },
    })
  }

  return value
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient()
    const value = Reflect.get(client, prop)
    return wrapPrismaValue(value, [prop])
  },
})

