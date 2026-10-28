import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirShift: { findFirst: vi.fn() },
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

const shift = {
  id: 'shift1',
  warungId: 'warung1',
  status: 'TERBUKA' as const,
  dibukaPada: new Date('2026-09-14T05:00:00.000Z'),
  ditutupPada: null,
  dibukaOleh: 'kasir1',
  ditutupOleh: null,
  catatanBuka: null,
  catatanTutup: null,
  createdAt: new Date('2026-09-14T05:00:00.000Z'),
  updatedAt: new Date('2026-09-14T05:00:00.000Z'),
}

describe('Current-shift open orders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters orders by the current open shift', async () => {
    vi.mocked(prisma.kasirShift.findFirst).mockResolvedValue(shift)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])

    const response = await GET(new NextRequest('http://localhost/api/transaksi/open'))

    expect(response.status).toBe(200)
    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        warungId: 'warung1',
        shiftId: 'shift1',
        status: 'OPEN',
      }),
    }))
  })

  it('returns no orders while cashier is closed', async () => {
    vi.mocked(prisma.kasirShift.findFirst).mockResolvedValue(null)

    const response = await GET(new NextRequest('http://localhost/api/transaksi/open'))
    const data = await response.json()

    expect(data.data).toEqual([])
    expect(prisma.transaksi.findMany).not.toHaveBeenCalled()
  })
})
