import { PrismaClient } from '@prisma/client'
import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import ws from 'ws'

function getPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  }

  // Pada environment Node.js lokal tanpa native WebSocket, gunakan ws
  if (typeof WebSocket === 'undefined') {
    neonConfig.webSocketConstructor = ws
  }
  // Gunakan HTTP fetch untuk query tunggal agar tidak menggantung di Cloudflare Workers
  neonConfig.poolQueryViaFetch = true

  const adapter = new PrismaNeon({ connectionString })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

// Di Cloudflare Workers, Proxy memastikan client dan I/O socket terinisialisasi pada execution context request yang aktif
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

