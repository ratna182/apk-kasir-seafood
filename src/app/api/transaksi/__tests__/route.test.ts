import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirShift: { findFirst: vi.fn() },
    menu: { findMany: vi.fn() },
    transaksi: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
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

import { GET, POST } from '../route'
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
const menu = {
  id: 'menu1',
  nama: 'Ikan Bakar',
  harga: 25000,
  warungId: 'warung1',
  categoryId: 'cat-1',
  sortOrder: 0,
  isAktif: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  warungMenus: [{ harga: 25000 }],
}

describe('Transaksi held order API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthContext).mockReturnValue(context)
    vi.mocked(requireRole).mockReturnValue(null)
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung1')
    vi.mocked(prisma.kasirShift.findFirst).mockResolvedValue(null)
  })

  it('rejects empty table number', async () => {
    const request = new NextRequest('http://localhost/api/transaksi', {
      method: 'POST',
      body: JSON.stringify({ nomorMeja: '', items: [{ menuId: 'menu1', qty: 1 }] }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Nomor meja')
  })

  it('creates an open order when table has no active order', async () => {
    vi.mocked(prisma.menu.findMany).mockResolvedValue([menu])
    const create = vi.fn().mockResolvedValue({ id: 'trx1', nomorMeja: 'Meja 1', status: 'OPEN', total: 25000, items: [] })
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: { findFirst: vi.fn().mockResolvedValue({ id: 'shift1', dibukaPada: new Date() }) },
      transaksi: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as never))

    const request = new NextRequest('http://localhost/api/transaksi', {
      method: 'POST',
      body: JSON.stringify({ nomorMeja: 'Meja 1', items: [{ menuId: 'menu1', qty: 1 }] }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.data.status).toBe('OPEN')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kasirId: 'kasir1' }) }))
  })

  it('lists completed transactions for the current open shift', async () => {
    vi.mocked(prisma.kasirShift.findFirst).mockResolvedValue({
      id: 'shift1',
      warungId: 'warung1',
      status: 'TERBUKA',
      dibukaPada: new Date('2026-09-14T05:00:00.000Z'),
      ditutupPada: null,
      dibukaOleh: 'kasir1',
      ditutupOleh: null,
      catatanBuka: null,
      catatanTutup: null,
      createdAt: new Date('2026-09-14T05:00:00.000Z'),
      updatedAt: new Date('2026-09-14T05:00:00.000Z'),
    })
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])

    const response = await GET(new NextRequest('http://localhost/api/transaksi'))

    expect(response.status).toBe(200)
    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warungId: 'warung1', shiftId: 'shift1', status: 'SELESAI' }),
    }))
  })

  it('returns no transactions while cashier is closed', async () => {
    vi.mocked(prisma.kasirShift.findFirst).mockResolvedValue(null)

    const response = await GET(new NextRequest('http://localhost/api/transaksi'))
    const data = await response.json()

    expect(data.data).toEqual([])
    expect(prisma.transaksi.findMany).not.toHaveBeenCalled()
  })
})
