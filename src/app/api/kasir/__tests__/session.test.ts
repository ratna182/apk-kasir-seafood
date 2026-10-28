import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  getKasirWarungId: vi.fn(),
  requireKasirAccess: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('@/lib/activity-log', () => ({
  recordActivity: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({
  apiRateLimiter: { check: vi.fn(() => ({ allowed: true, remaining: 99, resetIn: 60000 })) },
}))

import { POST as bukaKasir } from '../buka/route'
import { POST as tutupKasir } from '../tutup/route'
import { POST as tutupPaksa } from '../tutup-paksa/route'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess, requireRole } from '@/lib/auth'
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

const ownerContext: AuthContext = {
  user: {
    id: 'owner1',
    username: 'owner1',
    namaLengkap: null,
    role: 'OWNER',
    warungId: null,
    warungNama: null,
    warungKode: null,
  },
  warungId: null,
}

const openShift = {
  id: 'shift1',
  warungId: 'warung1',
  status: 'TERBUKA' as const,
  dibukaPada: new Date('2026-09-14T05:00:00.000Z'),
  ditutupPada: null,
  dibukaOleh: 'kasir1',
  ditutupOleh: null,
  catatanBuka: null,
  catatanTutup: null,
  transaksis: [],
}

describe('Cashier shift lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthContext).mockReturnValue(context)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung1')
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
    vi.mocked(requireRole).mockReturnValue(null)
  })

  it('rejects closing while an unpaid order exists', async () => {
    const update = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: { findFirst: vi.fn().mockResolvedValue(openShift), update },
      transaksi: { findMany: vi.fn().mockResolvedValue([{ nomorMeja: 'Meja 7' }]) },
    } as never))

    const response = await tutupKasir(new NextRequest('http://localhost/api/kasir/tutup', { method: 'POST' }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('belum dibayar')
    expect(data.message).toContain('Meja 7')
    expect(update).not.toHaveBeenCalled()
  })

  it('closes the current shift and aggregates only paid transactions', async () => {
    const eventCreate = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: {
        findFirst: vi.fn().mockResolvedValue(openShift),
        update: vi.fn().mockResolvedValue({
          ...openShift,
          status: 'DITUTUP',
          ditutupPada: new Date('2026-09-14T12:00:00.000Z'),
        }),
      },
      kasirShiftEvent: { create: eventCreate },
      transaksi: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _count: { id: 2 }, _sum: { total: 50000 } }),
      },
    } as never))

    const response = await tutupKasir(new NextRequest('http://localhost/api/kasir/tutup', { method: 'POST' }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.data.totalTransaksi).toBe(2)
    expect(data.data.totalPendapatan).toBe(50000)
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ shiftId: 'shift1', jenis: 'TUTUP' }),
    })
  })

  it('rejects opening a new shift while one is already open', async () => {
    const create = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: { findFirst: vi.fn().mockResolvedValue(openShift), create },
    } as never))

    const response = await bukaKasir(new NextRequest('http://localhost/api/kasir/buka', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(409)
    expect(create).not.toHaveBeenCalled()
  })

  it('opens a new shift and records the open event', async () => {
    const eventCreate = vi.fn()
    const create = vi.fn().mockImplementation(({ data }) => ({ id: 'shift2', ...data }))
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: { findFirst: vi.fn().mockResolvedValue(null), create },
      kasirShiftEvent: { create: eventCreate },
    } as never))

    const response = await bukaKasir(new NextRequest('http://localhost/api/kasir/buka', {
      method: 'POST',
      body: JSON.stringify({}),
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data.shiftId).toBe('shift2')
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ shiftId: 'shift2', jenis: 'BUKA' }),
    })
  })

  it('requires a note before force-closing a shift', async () => {
    vi.mocked(getAuthContext).mockReturnValue(ownerContext)
    const transaction = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementation(transaction)

    const response = await tutupPaksa(new NextRequest('http://localhost/api/kasir/tutup-paksa', {
      method: 'POST',
      body: JSON.stringify({ warungId: 'warung1', catatan: 'x' }),
    }))

    expect(response.status).toBe(422)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('cancels unpaid orders when the owner force-closes a shift', async () => {
    vi.mocked(getAuthContext).mockReturnValue(ownerContext)
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const eventCreate = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirShift: {
        findFirst: vi.fn().mockResolvedValue(openShift),
        update: vi.fn().mockResolvedValue({
          ...openShift,
          status: 'DITUTUP',
          ditutupPada: new Date('2026-09-14T12:00:00.000Z'),
        }),
      },
      kasirShiftEvent: { create: eventCreate },
      transaksi: {
        updateMany,
        aggregate: vi.fn().mockResolvedValue({ _count: { id: 1 }, _sum: { total: 25000 } }),
      },
    } as never))

    const response = await tutupPaksa(new NextRequest('http://localhost/api/kasir/tutup-paksa', {
      method: 'POST',
      body: JSON.stringify({ warungId: 'warung1', catatan: 'Kasir lupa tutup shift' }),
    }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data.cancelledOrders).toBe(2)
    expect(updateMany).toHaveBeenCalledWith({
      where: { warungId: 'warung1', shiftId: 'shift1', status: 'OPEN' },
      data: { status: 'BATAL' },
    })
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ shiftId: 'shift1', jenis: 'PAKSA_TUTUP' }),
    })
  })
})
