import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireRole: vi.fn(),
  requireKasirAccess: vi.fn(),
  getKasirWarungId: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({
  apiRateLimiter: { check: vi.fn(() => ({ allowed: true, remaining: 99, resetIn: 60000 })) },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole, requireKasirAccess, getKasirWarungId } from '@/lib/auth'
import type { AuthContext } from '@/lib/auth'

const context: AuthContext = {
  user: {
    id: 'kasir1',
    username: 'kasir1',
    namaLengkap: null,
    role: 'KASIR',
    warungId: 'warung1',
    warungNama: null,
    warungKode: null,
  },
  warungId: 'warung1',
}

describe('Bayar order API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthContext).mockReturnValue(context)
    vi.mocked(requireRole).mockReturnValue(null)
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung1')
  })

  it('finalizes open order before receipt is rendered', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'trx1', total: 25000, items: [{ id: 'item1' }] })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: { findFirst: vi.fn().mockResolvedValue({ id: 'shift1', dibukaPada: new Date() }) },
      transaksi: {
        findFirst,
        count: vi.fn().mockResolvedValue(0),
        updateMany,
        findUnique: vi.fn().mockResolvedValue({ id: 'trx1', status: 'SELESAI', metodePembayaran: 'CASH', total: 25000, items: [{ id: 'item1' }] }),
      },
    } as never))

    const request = new NextRequest('http://localhost/api/transaksi/trx1/bayar', {
      method: 'POST',
      body: JSON.stringify({ metodePembayaran: 'CASH' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'trx1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data.status).toBe('SELESAI')
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'trx1', warungId: 'warung1', shiftId: 'shift1', status: 'OPEN' }),
    }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'trx1', warungId: 'warung1', shiftId: 'shift1', status: 'OPEN' }),
    }))
  })

  it('rejects when another process has already paid the order', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: { findFirst: vi.fn().mockResolvedValue({ id: 'shift1', dibukaPada: new Date() }) },
      transaksi: {
        findFirst: vi.fn().mockResolvedValue({ id: 'trx1', total: 25000, items: [{ id: 'item1' }] }),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as never))

    const request = new NextRequest('http://localhost/api/transaksi/trx1/bayar', {
      method: 'POST',
      body: JSON.stringify({ metodePembayaran: 'CASH' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'trx1' }) })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('baru saja dibayar')
  })

  it('rejects invalid payment method', async () => {
    const request = new NextRequest('http://localhost/api/transaksi/trx1/bayar', {
      method: 'POST',
      body: JSON.stringify({ metodePembayaran: 'INVALID_METHOD' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'trx1' }) })
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Metode')
  })
})
