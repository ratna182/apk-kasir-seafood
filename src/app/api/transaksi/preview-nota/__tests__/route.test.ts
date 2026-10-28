import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transaksi: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    warung: { findUnique: vi.fn() },
    menu: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireKasirAccess: vi.fn(),
  getKasirWarungId: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({
  apiRateLimiter: { check: vi.fn(() => ({ allowed: true, remaining: 99, resetIn: 60000 })) },
}))

vi.mock('@/lib/kasir-shift', () => ({
  getOpenShift: vi.fn(),
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireKasirAccess, getKasirWarungId } from '@/lib/auth'
import { getOpenShift } from '@/lib/kasir-shift'
import { apiRateLimiter } from '@/lib/rate-limiter'
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

const shift = {
  id: 'shift1',
  warungId: 'warung1',
  status: 'TERBUKA' as const,
  dibukaPada: new Date('2026-10-28T01:00:00.000Z'),
  ditutupPada: null,
  dibukaOleh: 'kasir1',
  ditutupOleh: null,
  catatanBuka: null,
  catatanTutup: null,
}

const warung = { nama: 'Seafood Vian Jaya 08', alamat: 'Kranggan' }

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

const openOrder = {
  id: 'trx1',
  nomorMeja: 'Meja 1',
  status: 'OPEN',
  total: 25000,
  items: [
    {
      id: 'item1',
      namaMenu: 'Ikan Bakar',
      qty: 1,
      hargaSatuan: 25000,
      diskonSatuan: 0,
      catatan: null,
      subtotal: 25000,
    },
  ],
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/transaksi/preview-nota', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('Preview nota API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthContext).mockReturnValue(context)
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung1')
    vi.mocked(getOpenShift).mockResolvedValue(shift as never)
    vi.mocked(prisma.warung.findUnique).mockResolvedValue(warung as never)
    vi.mocked(prisma.menu.findMany).mockResolvedValue([menu] as never)
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue(null)
  })

  it('computes a new table preview total on the server without writing data', async () => {
    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      total: 1,
      items: [{ menuId: 'menu1', qty: 2 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data).toMatchObject({
      orderId: null,
      nomorMeja: 'Meja 1',
      warungNama: 'Seafood Vian Jaya 08',
      total: 50000,
      existingTotal: 0,
      addedTotal: 50000,
    })
    expect(data.data.items).toEqual([
      expect.objectContaining({ menuId: 'menu1', namaMenu: 'Ikan Bakar', qty: 2, subtotal: 50000 }),
    ])
    expect(prisma.transaksi.create).not.toHaveBeenCalled()
    expect(prisma.transaksi.update).not.toHaveBeenCalled()
    expect(prisma.transaksi.updateMany).not.toHaveBeenCalled()
    expect(prisma.transaksi.delete).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('combines saved order items with new items and computes the total on the server', async () => {
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue(openOrder as never)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      items: [{ menuId: 'menu1', qty: 2 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toMatchObject({
      orderId: 'trx1',
      total: 75000,
      existingTotal: 25000,
      addedTotal: 50000,
    })
    expect(data.data.items).toHaveLength(2)
    expect(data.data.items[0].namaMenu).toBe('Ikan Bakar')
    expect(prisma.transaksi.create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('previews a saved order without adding new items', async () => {
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue(openOrder as never)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      items: [],
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toMatchObject({
      orderId: 'trx1',
      total: 25000,
      existingTotal: 25000,
      addedTotal: 0,
    })
    expect(data.data.items).toHaveLength(1)
    expect(prisma.menu.findMany).not.toHaveBeenCalled()
  })

  it('rejects a table that already has an open order without orderId', async () => {
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue({ id: 'trx-existing' } as never)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('order tersimpan')
    expect(prisma.menu.findMany).not.toHaveBeenCalled()
  })

  it('rejects a selected order that is no longer open', async () => {
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue(null)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('tidak ditemukan')
    expect(prisma.menu.findMany).not.toHaveBeenCalled()
  })

  it('rejects an order whose saved table does not match', async () => {
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue({ ...openOrder, nomorMeja: 'Meja 2' } as never)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Nomor meja')
  })

  it('rejects preview while the cashier shift is closed', async () => {
    vi.mocked(getOpenShift).mockResolvedValue(null)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toBe('Buka kasir terlebih dahulu.')
    expect(prisma.menu.findMany).not.toHaveBeenCalled()
  })

  it('rejects an invalid table before touching the database', async () => {
    const response = await POST(makeRequest({
      nomorMeja: 'Meja 99',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Nomor meja')
    expect(prisma.warung.findUnique).not.toHaveBeenCalled()
  })

  it('rejects an empty cart without a selected order', async () => {
    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('kosong')
    expect(prisma.menu.findMany).not.toHaveBeenCalled()
  })

  it('rejects an invalid menu without writing data', async () => {
    vi.mocked(prisma.menu.findMany).mockResolvedValue([])

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [{ menuId: 'menu-x', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('tidak valid')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rate limits preview requests', async () => {
    vi.mocked(apiRateLimiter.check).mockReturnValueOnce({ allowed: false, remaining: 0, resetIn: 1000 })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data.message).toContain('Terlalu banyak')
    expect(prisma.warung.findUnique).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON without touching the database', async () => {
    const request = new NextRequest('http://localhost/api/transaksi/preview-nota', {
      method: 'POST',
      body: '{',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('tidak valid')
    expect(prisma.warung.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a non-string orderId', async () => {
    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 123,
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Order tersimpan')
    expect(prisma.warung.findUnique).not.toHaveBeenCalled()
  })

  it('rejects an empty orderId', async () => {
    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: '   ',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Order tersimpan')
    expect(prisma.warung.findUnique).not.toHaveBeenCalled()
  })

  it('rejects preview when the warung is missing', async () => {
    vi.mocked(prisma.warung.findUnique).mockResolvedValue(null)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.message).toContain('Warung')
    expect(prisma.menu.findMany).not.toHaveBeenCalled()
  })

  it('rejects a saved order without items', async () => {
    vi.mocked(prisma.transaksi.findFirst).mockResolvedValue({ ...openOrder, items: [] } as never)

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      items: [],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('belum punya item')
  })

  it('returns a safe error when the database fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(prisma.warung.findUnique).mockRejectedValue(new Error('db down'))

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.message).toBe('Gagal memuat preview nota.')
    errorSpy.mockRestore()
  })
})
