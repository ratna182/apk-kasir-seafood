import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  getKasirWarungId: vi.fn(),
  requireKasirAccess: vi.fn(),
}))

import { POST as bukaKasir } from '../buka/route'
import { POST as tutupKasir } from '../tutup/route'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
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

const closedSession = {
  id: 'session1',
  warungId: 'warung1',
  tanggal: new Date('2026-09-14'),
  ditutupOleh: 'kasir1',
  dibukaPada: null,
  ditutupPada: new Date('2026-09-14T04:00:00.000Z'),
  dibukaKembaliPada: null,
  totalTransaksi: 2,
  totalPendapatan: 50000,
}

describe('Cashier session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthContext).mockReturnValue(context)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung1')
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
  })

  it('rejects closing while an unpaid order exists', async () => {
    const create = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirSesi: { findFirst: vi.fn().mockResolvedValue(null), create },
      transaksi: { findMany: vi.fn().mockResolvedValue([{ nomorMeja: 'Meja 7' }]) },
    } as never))

    const response = await tutupKasir(new NextRequest('http://localhost/api/kasir/tutup', { method: 'POST' }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.message).toContain('belum dibayar')
    expect(data.message).toContain('Meja 7')
    expect(create).not.toHaveBeenCalled()
  })

  it('summarizes only paid transactions from the current session', async () => {
    const reopenedAt = new Date('2026-09-14T05:00:00.000Z')
    const create = vi.fn().mockImplementation(({ data }) => ({ id: 'session2', ...data }))
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 20000 }, { total: 30000 }])
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirSesi: {
        findFirst: vi.fn().mockResolvedValue({ ...closedSession, dibukaKembaliPada: reopenedAt }),
        create,
      },
      transaksi: { findMany, updateMany },
    } as never))

    const response = await tutupKasir(new NextRequest('http://localhost/api/kasir/tutup', { method: 'POST' }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.data.totalTransaksi).toBe(2)
    expect(data.data.totalPendapatan).toBe(50000)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: expect.objectContaining({ gte: reopenedAt }) }),
    }))
    expect(updateMany).toHaveBeenCalledWith({
      where: { warungId: 'warung1', kasirId: 'kasir1', status: 'OPEN', createdAt: { lt: reopenedAt } },
      data: { status: 'BATAL' },
    })
  })

  it('reopens by timestamping the summary instead of deleting it', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({
      kasirSesi: { findFirst: vi.fn().mockResolvedValue(closedSession), updateMany },
    } as never))

    const response = await bukaKasir(new NextRequest('http://localhost/api/kasir/buka', {
      method: 'POST',
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(200)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: closedSession.id, dibukaKembaliPada: null },
      data: expect.objectContaining({ dibukaPada: expect.any(Date), dibukaKembaliPada: expect.any(Date) }),
    }))
  })
})
