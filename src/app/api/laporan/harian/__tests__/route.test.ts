import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirSesi: { findFirst: vi.fn() },
    transaksi: { findMany: vi.fn() },
    activityLog: { findMany: vi.fn() },
    warung: { findUnique: vi.fn() },
    menu: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(() => ({
    user: { id: 'kasir1', role: 'KASIR' },
    warungId: 'warung1',
  })),
  isOwner: vi.fn(() => false),
  requireWarungAccess: vi.fn(() => null),
}))

import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { getStoreDayRange } from '@/lib/time'

describe('Current cashier session report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.warung.findUnique).mockResolvedValue({
      id: 'warung1',
      nama: 'Seafood 08',
      kode: 'VJ08-1',
      alamat: null,
      createdAt: new Date(),
    })
    vi.mocked(prisma.menu.findMany).mockResolvedValue([])
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([])
  })

  it('includes all transactions for the day even after cashier reopens', async () => {
    const reopenedAt = new Date('2026-09-14T05:00:00.000Z')
    const today = getStoreDayRange().today
    vi.mocked(prisma.kasirSesi.findFirst).mockResolvedValue({
      id: 'session1',
      warungId: 'warung1',
      tanggal: today,
      ditutupOleh: 'kasir1',
      ditutupPada: new Date('2026-09-14T04:00:00.000Z'),
      dibukaKembaliPada: reopenedAt,
      totalTransaksi: 2,
      totalPendapatan: 375000,
    })
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian'))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.data).toEqual(expect.objectContaining({
      jumlahTransaksi: 0,
      grandTotalQty: 0,
      grandTotalPendapatan: 0,
      totalCash: 0,
      totalQRIS: 0,
      totalTransfer: 0,
      rekap: [],
    }))
    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: expect.objectContaining({ gte: today }) }),
    }))
  })

  it('reports all transactions for the day across repeated open and close cycles', async () => {
    const today = getStoreDayRange().today
    const reopenedAt = new Date('2026-09-14T11:00:00.000Z')
    const closedAt = new Date('2026-09-14T15:00:00.000Z')
    vi.mocked(prisma.kasirSesi.findFirst)
      .mockResolvedValueOnce({
        id: 'session3',
        warungId: 'warung1',
        tanggal: today,
        ditutupOleh: 'kasir2',
        ditutupPada: closedAt,
        dibukaKembaliPada: null,
        totalTransaksi: 1,
        totalPendapatan: 25000,
      })
      .mockResolvedValueOnce({
        id: 'session2',
        warungId: 'warung1',
        tanggal: today,
        ditutupOleh: 'kasir1',
        ditutupPada: new Date('2026-09-14T10:00:00.000Z'),
        dibukaKembaliPada: reopenedAt,
        totalTransaksi: 2,
        totalPendapatan: 50000,
      })
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian'))

    expect(response.status).toBe(200)
    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: today, lt: getStoreDayRange().tomorrow } }),
    }))
  })

  it('includes all cashier open and close activities', async () => {
    vi.mocked(prisma.kasirSesi.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([
      {
        id: 'log-1',
        userId: 'kasir1',
        warungId: 'warung1',
        aktivitas: 'TUTUP_KASIR',
        detail: 'Kasir ditutup',
        createdAt: new Date('2026-09-14T10:00:00.000Z'),
        user: { namaLengkap: 'Kasir Satu', username: 'kasir1' },
      },
      {
        id: 'log-2',
        userId: 'kasir2',
        warungId: 'warung1',
        aktivitas: 'BUKA_KASIR',
        detail: 'Sesi kasir dibuka kembali',
        createdAt: new Date('2026-09-14T11:00:00.000Z'),
        user: { namaLengkap: null, username: 'kasir2' },
      },
    ] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian'))
    const result = await response.json()

    expect(result.data.aktivitasKasir).toEqual([
      expect.objectContaining({ aktivitas: 'TUTUP_KASIR', kasir: 'Kasir Satu' }),
      expect.objectContaining({ aktivitas: 'BUKA_KASIR', kasir: 'kasir2' }),
    ])
  })

  it('includes cashier login activities', async () => {
    vi.mocked(prisma.kasirSesi.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([
      {
        id: 'log-login',
        userId: 'kasir1',
        warungId: 'warung1',
        aktivitas: 'LOGIN',
        detail: 'Kasir berhasil login',
        createdAt: new Date('2026-09-14T09:30:00.000Z'),
        user: { namaLengkap: 'Kasir Satu', username: 'kasir1' },
      },
    ] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian'))
    const result = await response.json()

    expect(result.data.aktivitasKasir).toEqual([
      expect.objectContaining({ aktivitas: 'LOGIN', kasir: 'Kasir Satu', detail: 'Kasir berhasil login' }),
    ])
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ aktivitas: { in: ['LOGIN', 'BUKA_KASIR', 'TUTUP_KASIR'] } }),
    }))
  })
})
