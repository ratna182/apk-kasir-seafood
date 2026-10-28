import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirShift: { findMany: vi.fn() },
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
import { getStoreDayRangeForDateKey } from '@/lib/time'

const now = new Date('2026-09-14T04:00:00.000Z')

function makeShift(id: string, openedAt: Date, closedAt: Date | null, transaksis: unknown[] = []) {
  return {
    id,
    warungId: 'warung1',
    status: closedAt ? 'DITUTUP' : 'TERBUKA',
    dibukaPada: openedAt,
    ditutupPada: closedAt,
    dibukaOleh: 'kasir1',
    ditutupOleh: closedAt ? 'kasir1' : null,
    catatanBuka: null,
    catatanTutup: null,
    pembuka: { namaLengkap: 'Kasir Satu', username: 'kasir1' },
    penutup: closedAt ? { namaLengkap: 'Kasir Satu', username: 'kasir1' } : null,
    transaksis,
  }
}

function makeTransaction(id: string, total: number, method: 'CASH' | 'QRIS' | 'TRANSFER' = 'CASH') {
  return {
    id,
    nomorMeja: 'Meja 1',
    total,
    metodePembayaran: method,
    createdAt: now,
    items: [{
      id: `item-${id}`,
      transaksiId: id,
      menuId: 'menu1',
      namaMenu: 'Ikan Bakar',
      hargaSatuan: total,
      diskonSatuan: 0,
      catatan: null,
      qty: 1,
      subtotal: total,
      createdAt: now,
    }],
  }
}

describe('Daily shift report', () => {
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
    vi.mocked(prisma.kasirShift.findMany).mockResolvedValue([])
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([])
  })

  it('groups transactions by shifts opened on the requested WIB date', async () => {
    const openedAt = new Date('2026-09-14T01:00:00.000Z')
    vi.mocked(prisma.kasirShift.findMany).mockResolvedValue([
      makeShift('shift1', openedAt, new Date('2026-09-14T10:00:00.000Z'), [makeTransaction('trx1', 25000, 'QRIS')]),
    ] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()
    const day = getStoreDayRangeForDateKey('2026-09-14')

    expect(response.status).toBe(200)
    expect(prisma.kasirShift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warungId: 'warung1', dibukaPada: { gte: day.today, lt: day.tomorrow } }),
    }))
    expect(result.data.shifts).toHaveLength(1)
    expect(result.data.shifts[0]).toEqual(expect.objectContaining({
      id: 'shift1',
      label: 'Shift 1',
      totalTransaksi: 1,
      totalPendapatan: 25000,
      totalQRIS: 25000,
    }))
    expect(result.data.jumlahTransaksi).toBe(1)
    expect(result.data.grandTotalPendapatan).toBe(25000)
  })

  it('keeps transactions after midnight inside the shift that opened the previous day', async () => {
    const openedAt = new Date('2026-09-13T17:30:00.000Z')
    const afterMidnight = new Date('2026-09-13T18:30:00.000Z')
    vi.mocked(prisma.kasirShift.findMany).mockResolvedValue([
      makeShift('shift1', openedAt, new Date('2026-09-14T02:00:00.000Z'), [{
        ...makeTransaction('trx1', 50000),
        createdAt: afterMidnight,
      }]),
    ] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()

    expect(result.data.tanggal).toBe('2026-09-14')
    expect(result.data.shifts[0].totalTransaksi).toBe(1)
    expect(result.data.transaksi[0].createdAt).toBe(afterMidnight.toISOString())
  })

  it('combines multiple shifts opened on the same date', async () => {
    vi.mocked(prisma.kasirShift.findMany).mockResolvedValue([
      makeShift('shift1', new Date('2026-09-14T01:00:00.000Z'), new Date('2026-09-14T04:00:00.000Z'), [makeTransaction('trx1', 25000)]),
      makeShift('shift2', new Date('2026-09-14T05:00:00.000Z'), new Date('2026-09-14T10:00:00.000Z'), [makeTransaction('trx2', 50000, 'TRANSFER')]),
    ] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()

    expect(result.data.shifts).toHaveLength(2)
    expect(result.data.jumlahTransaksi).toBe(2)
    expect(result.data.grandTotalPendapatan).toBe(75000)
    expect(result.data.totalCash).toBe(25000)
    expect(result.data.totalTransfer).toBe(50000)
  })

  it('includes legacy transactions without a shift', async () => {
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([makeTransaction('legacy1', 30000)] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()

    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shiftId: null, status: 'SELESAI' }),
    }))
    expect(result.data.shifts).toHaveLength(1)
    expect(result.data.shifts[0].label).toBe('Tanpa shift (data lama)')
    expect(result.data.grandTotalPendapatan).toBe(30000)
  })

  it('includes all cashier open and close activities', async () => {
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

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()

    expect(result.data.aktivitasKasir).toEqual([
      expect.objectContaining({ aktivitas: 'TUTUP_KASIR', kasir: 'Kasir Satu' }),
      expect.objectContaining({ aktivitas: 'BUKA_KASIR', kasir: 'kasir2' }),
    ])
  })

  it('includes cashier login activities', async () => {
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

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()

    expect(result.data.aktivitasKasir).toEqual([
      expect.objectContaining({ aktivitas: 'LOGIN', kasir: 'Kasir Satu', detail: 'Kasir berhasil login' }),
    ])
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ aktivitas: { in: ['LOGIN', 'BUKA_KASIR', 'TUTUP_KASIR'] } }),
    }))
  })

  it('groups each menu under its own category and labels unknown menus as Tanpa kategori', async () => {
    vi.mocked(prisma.menu.findMany).mockResolvedValue([
      { id: 'menu-ikan', category: { nama: 'Ikan Bakar' } },
      { id: 'menu-es', category: { nama: 'Minuman' } },
    ] as never)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([
      {
        id: 'trx-1',
        warungId: 'warung1',
        kasirId: 'kasir1',
        nomorMeja: 'Meja 1',
        status: 'SELESAI',
        metodePembayaran: 'CASH',
        total: 50000,
        tanggal: now,
        createdAt: now,
        updatedAt: now,
        printedAt: null,
        items: [
          {
            id: 'item-1',
            transaksiId: 'trx-1',
            menuId: 'menu-ikan',
            namaMenu: 'Ikan Bakar',
            hargaSatuan: 45000,
            diskonSatuan: 0,
            catatan: null,
            qty: 1,
            subtotal: 45000,
            createdAt: now,
          },
          {
            id: 'item-2',
            transaksiId: 'trx-1',
            menuId: 'menu-es',
            namaMenu: 'Es Teh Manis',
            hargaSatuan: 5000,
            diskonSatuan: 0,
            catatan: null,
            qty: 1,
            subtotal: 5000,
            createdAt: now,
          },
          {
            id: 'item-3',
            transaksiId: 'trx-1',
            menuId: 'menu-terhapus',
            namaMenu: 'Menu Lama',
            hargaSatuan: 0,
            diskonSatuan: 0,
            catatan: null,
            qty: 1,
            subtotal: 0,
            createdAt: now,
          },
        ],
      },
    ] as never)

    const response = await GET(new NextRequest('http://localhost/api/laporan/harian?tanggal=2026-09-14'))
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.data.rekap).toEqual([
      { namaMenu: 'Ikan Bakar', kategori: 'Ikan Bakar', qtyTotal: 1, pendapatanTotal: 45000 },
      { namaMenu: 'Es Teh Manis', kategori: 'Minuman', qtyTotal: 1, pendapatanTotal: 5000 },
      { namaMenu: 'Menu Lama', kategori: 'Tanpa kategori', qtyTotal: 1, pendapatanTotal: 0 },
    ])
  })
})
