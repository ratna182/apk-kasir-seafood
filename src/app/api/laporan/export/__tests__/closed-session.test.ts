import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kasirShift: { findMany: vi.fn() },
    warung: { findUnique: vi.fn() },
    transaksi: { findMany: vi.fn() },
    menu: { findMany: vi.fn() },
    activityLog: { findMany: vi.fn() },
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
  const shift = {
    id: 'shift1',
    warungId: 'warung1',
    status: 'TERBUKA',
    dibukaPada: new Date('2026-09-14T01:00:00.000Z'),
    ditutupPada: null,
    dibukaOleh: 'kasir1',
    ditutupOleh: null,
    catatanBuka: null,
    catatanTutup: null,
    pembuka: { namaLengkap: 'Kasir Satu', username: 'kasir1' },
    penutup: null,
    transaksis: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.kasirShift.findMany).mockResolvedValue([shift] as never)
    vi.mocked(prisma.activityLog.findMany).mockResolvedValue([])
    vi.mocked(prisma.warung.findUnique).mockResolvedValue({ id: 'warung1', nama: 'Seafood 08', kode: 'VJ08-1', alamat: null, createdAt: new Date() })
    vi.mocked(prisma.menu.findMany).mockResolvedValue([{ id: 'menu1', category: { nama: 'MAKANAN' } }] as never)
    vi.mocked(prisma.transaksi.findMany).mockResolvedValue([{
      id: 'tx1',
      warungId: 'warung1',
      kasirId: 'kasir1',
      shiftId: 'shift1',
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
  })

  it.each([
    ['Excel', exportExcel, '/api/laporan/export'],
    ['PDF', exportPdf, '/api/laporan/export/pdf'],
  ])('generates a valid %s file for an open shift', async (format, handler, path) => {
    const response = await handler(new NextRequest(`http://localhost${path}?tanggal=2026-09-14`))
    const bytes = await response.arrayBuffer()

    expect(response.status).toBe(200)
    expect(prisma.kasirShift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ warungId: 'warung1' }),
    }))
    if (format === 'Excel') {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(bytes)
      expect(workbook.getWorksheet('Rekap Shift')?.rowCount).toBeGreaterThan(1)
      expect(workbook.getWorksheet('Detail Transaksi')?.rowCount).toBeGreaterThan(1)
    } else {
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount()).toBeGreaterThan(0)
    }
  })
})
