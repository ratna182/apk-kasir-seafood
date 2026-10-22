import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirSesi: { findFirst: vi.fn() },
    transaksi: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(() => ({ user: { id: 'kasir1', role: 'KASIR' }, warungId: 'warung1' })),
  getKasirWarungId: vi.fn(() => 'warung1'),
  requireKasirAccess: vi.fn(() => null),
}))

import { GET } from '../route'
import { prisma } from '@/lib/prisma'

const session = {
  id: 'session1',
  warungId: 'warung1',
  tanggal: new Date('2026-09-14'),
  ditutupOleh: 'kasir1',
  dibukaPada: null,
  ditutupPada: new Date('2026-09-14T04:00:00.000Z'),
  dibukaKembaliPada: new Date('2026-09-14T05:00:00.000Z'),
  totalTransaksi: 1,
  totalPendapatan: 25000,
}

describe('Current-session open orders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters orders from the latest reopen time', async () => {
    vi.mocked(prisma.kasirSesi.findFirst).mockResolvedValue(session)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])

    const response = await GET(new NextRequest('http://localhost/api/transaksi/open'))

    expect(response.status).toBe(200)
    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        kasirId: 'kasir1',
        createdAt: { gte: session.dibukaKembaliPada },
        status: 'OPEN',
      }),
    }))
  })

  it('returns no orders while cashier is closed', async () => {
    vi.mocked(prisma.kasirSesi.findFirst).mockResolvedValue({ ...session, dibukaKembaliPada: null })

    const response = await GET(new NextRequest('http://localhost/api/transaksi/open'))
    const data = await response.json()

    expect(data.data).toEqual([])
    expect(prisma.transaksi.findMany).not.toHaveBeenCalled()
  })
})
