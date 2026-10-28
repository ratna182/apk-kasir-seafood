import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    transaksi: { findFirst: vi.fn() },
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
  createdAt: new Date(),
  updatedAt: new Date(),
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

const key = '1234567890abcdef1234567890abcdef'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/transaksi/bayar-langsung', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function transactionMock(options: {
  existingByKey?: Record<string, unknown> | null
  openOrder?: Record<string, unknown> | null
  tableOrder?: Record<string, unknown> | null
  shift?: Record<string, unknown> | null
  completedInShift?: number
  updateCount?: number
  createResult?: Record<string, unknown>
  updateResult?: Record<string, unknown>
} = {}) {
  const findFirst = vi.fn()
    .mockResolvedValueOnce(options.existingByKey ?? null)
    .mockResolvedValueOnce(options.openOrder ?? options.tableOrder ?? null)
  const create = vi.fn().mockResolvedValue(options.createResult ?? { id: 'trx1', status: 'SELESAI', total: 50000, items: [] })
  const updateMany = vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 })
  const findUnique = vi.fn().mockResolvedValue(options.updateResult ?? { id: 'trx1', status: 'SELESAI', total: 50000, items: [] })

  const createMany = vi.fn().mockResolvedValue({ count: 1 })

  const tx = {
    kasirShift: { findFirst: vi.fn().mockResolvedValue(options.shift === undefined ? shift : options.shift) },
    menu: { findMany: vi.fn().mockResolvedValue([menu]) },
    transaksiItem: { createMany },
    transaksi: {
      findFirst,
      count: vi.fn().mockResolvedValue(options.completedInShift ?? 0),
      create,
      updateMany,
      findUnique,
    },
  }

  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never))
  return { tx, findFirst, create, updateMany, findUnique }
}

describe('Bayar langsung API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthContext).mockReturnValue(context)
    vi.mocked(requireRole).mockReturnValue(null)
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung1')
  })

  it('creates a completed order and computes total on the server', async () => {
    const { create } = transactionMock()

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      idempotencyKey: key,
      metodePembayaran: 'CASH',
      uangDiterima: 100000,
      total: 1,
      items: [{ menuId: 'menu1', qty: 2 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.success).toBe(true)
    expect(data.meta.cash).toEqual({ uangDiterima: 100000, kembalian: 50000, message: expect.stringContaining('Kembalian') })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        warungId: 'warung1',
        kasirId: 'kasir1',
        shiftId: 'shift1',
        status: 'SELESAI',
        total: 50000,
        idempotencyKey: key,
      }),
    }))
  })

  it('returns the same transaction when the idempotency key is retried', async () => {
    const existing = { id: 'trx1', status: 'SELESAI', total: 50000, items: [] }
    const { create, tx } = transactionMock({ existingByKey: existing })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      idempotencyKey: key,
      metodePembayaran: 'CASH',
      uangDiterima: 60000,
      items: [{ menuId: 'menu1', qty: 2 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meta.idempotent).toBe(true)
    expect(data.data.id).toBe('trx1')
    expect(data.meta.cash.kembalian).toBe(10000)
    expect(create).not.toHaveBeenCalled()
    expect(tx.transaksi.count).not.toHaveBeenCalled()
  })

  it('appends to a selected open order and finalizes it atomically', async () => {
    const openOrder = {
      id: 'trx1',
      nomorMeja: 'Meja 1',
      status: 'OPEN',
      total: 25000,
      items: [{ id: 'item1', subtotal: 25000 }],
    }
    const { create, updateMany, findUnique } = transactionMock({ openOrder })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      idempotencyKey: key,
      metodePembayaran: 'QRIS',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.meta.idempotent).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'trx1', status: 'OPEN', shiftId: 'shift1' }),
      data: expect.objectContaining({ status: 'SELESAI', total: 50000, metodePembayaran: 'QRIS' }),
    }))
    expect(findUnique).toHaveBeenCalled()
  })

  it('finalizes a selected open order without adding new items', async () => {
    const openOrder = {
      id: 'trx1',
      nomorMeja: 'Meja 1',
      status: 'OPEN',
      total: 25000,
      items: [{ id: 'item1', subtotal: 25000 }],
    }
    const { create, updateMany, tx } = transactionMock({ openOrder })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      idempotencyKey: key,
      metodePembayaran: 'CASH',
      uangDiterima: 25000,
      items: [],
    }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.meta.cash.kembalian).toBe(0)
    expect(create).not.toHaveBeenCalled()
    expect(tx.transaksiItem.createMany).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SELESAI', total: 25000 }),
    }))
  })

  it('rejects a table that already has an open order without orderId', async () => {
    const { create } = transactionMock({ tableOrder: { id: 'trx-existing' } })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      idempotencyKey: key,
      metodePembayaran: 'QRIS',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('order tersimpan')
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects cash below the server total without creating an order', async () => {
    const { create } = transactionMock()

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      idempotencyKey: key,
      metodePembayaran: 'CASH',
      uangDiterima: 10000,
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('kurang')
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects payment while the cashier shift is closed', async () => {
    const { create } = transactionMock({ shift: null })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      idempotencyKey: key,
      metodePembayaran: 'QRIS',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toBe('Buka kasir terlebih dahulu.')
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects when another process already claimed the open order', async () => {
    const openOrder = {
      id: 'trx1',
      nomorMeja: 'Meja 1',
      status: 'OPEN',
      total: 25000,
      items: [{ id: 'item1', subtotal: 25000 }],
    }
    transactionMock({ openOrder, updateCount: 0 })

    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      orderId: 'trx1',
      idempotencyKey: key,
      metodePembayaran: 'QRIS',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('baru saja dibayar')
  })

  it('rejects an invalid idempotency key before touching the database', async () => {
    const response = await POST(makeRequest({
      nomorMeja: 'Meja 1',
      idempotencyKey: 'short',
      metodePembayaran: 'QRIS',
      items: [{ menuId: 'menu1', qty: 1 }],
    }))
    const data = await response.json()

    expect(response.status).toBe(422)
    expect(data.message).toContain('Idempotency')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
