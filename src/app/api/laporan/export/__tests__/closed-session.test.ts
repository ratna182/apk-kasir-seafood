import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirSesi: { findFirst: vi.fn() },
    warung: { findUnique: vi.fn() },
    transaksi: { findMany: vi.fn() },
    menu: { findFirst: vi.fn(), findMany: vi.fn() },
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

import { GET as exportExcel } from '../route'
import { GET as exportPdf } from '../pdf/route'
import { prisma } from '@/lib/prisma'

describe('Financial report export', () => {
  const openSession = {
    id: 'session1',
    warungId: 'warung1',
    tanggal: new Date('2026-09-14'),
    ditutupOleh: 'kasir1',
    dibukaPada: null,
    ditutupPada: new Date('2026-09-14T08:00:00.000Z'),
    dibukaKembaliPada: new Date('2026-09-14T08:00:00.000Z'),
    totalTransaksi: 0,
    totalPendapatan: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.kasirSesi.findFirst).mockResolvedValue(openSession)
    vi.mocked(prisma.warung.findUnique).mockResolvedValue({ id: 'warung1', nama: 'Seafood 08', kode: 'VJ08-1', alamat: null, createdAt: new Date() })
    vi.mocked(prisma.menu.findFirst).mockResolvedValue({ category: { nama: 'MAKANAN' } } as never)
    vi.mocked(prisma.menu.findMany).mockResolvedValue([{ id: 'menu1', category: { nama: 'MAKANAN' } }] as never)
  })

  it.each([
    ['Excel', exportExcel, '/api/laporan/export'],
    ['PDF', exportPdf, '/api/laporan/export/pdf'],
  ])('rejects %s export while cashier is open', async (_format, handler, path) => {
    const response = await handler(new NextRequest(`http://localhost${path}`))
    const result = await response.json()

    expect(response.status).toBe(409)
    expect(result.message).toContain('Tutup kasir terlebih dahulu')
  })

  it.each([
    ['Excel', exportExcel, '/api/laporan/export'],
    ['PDF', exportPdf, '/api/laporan/export/pdf'],
  ])('generates a valid %s file for only the closed cashier cycle', async (format, handler, path) => {
    const closedAt = new Date('2026-09-14T12:00:00.000Z')
    vi.mocked(prisma.kasirSesi.findFirst)
      .mockResolvedValueOnce({ ...openSession, id: 'session2', ditutupPada: closedAt, dibukaKembaliPada: null, totalTransaksi: 1, totalPendapatan: 25000 })
      .mockResolvedValueOnce(openSession)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([{
      id: 'tx1',
      warungId: 'warung1',
      kasirId: 'kasir1',
      nomorMeja: 'Meja 1',
      status: 'SELESAI',
      metodePembayaran: 'CASH',
      total: 25000,
      tanggal: new Date('2026-09-14'),
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
      printedAt: null,
      items: [{ id: 'item1', transaksiId: 'tx1', menuId: 'menu1', namaMenu: 'Udang', hargaSatuan: 25000, diskonSatuan: 0, catatan: null, qty: 1, subtotal: 25000, createdAt: new Date() }],
    }] as never)

    const response = await handler(new NextRequest(`http://localhost${path}`))
    const bytes = await response.arrayBuffer()

    expect(response.status).toBe(200)
    expect(prisma.transaksi.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ kasirId: 'kasir1', createdAt: { gte: openSession.dibukaKembaliPada, lte: closedAt } }),
    }))
    if (format === 'Excel') {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(bytes)
      expect(workbook.getWorksheet('Detail Transaksi')?.rowCount).toBeGreaterThan(1)
    } else {
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount()).toBeGreaterThan(0)
    }
  })
})
