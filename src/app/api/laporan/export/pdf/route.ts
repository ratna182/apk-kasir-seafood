import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { compareIndonesian } from '@/lib/menu-sort'
import { normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'
import { getAuthContext, isOwner, requireWarungAccess } from '@/lib/auth'
import { getKasirSessionState } from '@/lib/kasir-session'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// GET /api/laporan/export/pdf — export laporan ke PDF
// Query params: warung_id (required untuk owner)
export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)

    const { searchParams } = new URL(request.url)
    const warungIdParam = searchParams.get('warung_id')

    let warungId: string

    if (context) {
      if (isOwner(context)) {
        if (!warungIdParam) {
          return NextResponse.json({ success: false, message: 'warung_id wajib diisi untuk owner.' }, { status: 400 })
        }
        const warungAccessError = requireWarungAccess(context, warungIdParam)
        if (warungAccessError) return warungAccessError
        warungId = warungIdParam
      } else {
        warungId = context.warungId ?? ''
        if (!warungId) {
          return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
        }
      }
    } else {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    const kasirId = context.user.id
    const state = await getKasirSessionState(prisma, warungId, kasirId)
    if (!state.isClosed) {
      return NextResponse.json({ success: false, message: 'Tutup kasir terlebih dahulu sebelum mencetak laporan.' }, { status: 409 })
    }

    const startDate = state.sessionStart
    const endDate = state.sessionEnd

    // Ambil info warung
    const warung = await prisma.warung.findUnique({
      where: { id: warungId },
      select: { nama: true, kode: true },
    })

    // Export hanya untuk siklus kasir yang baru ditutup.
    const transaksis = await prisma.transaksi.findMany({
      where: {
        warungId,
        kasirId,
        createdAt: { gte: state.sessionStart, lte: state.sessionEnd },
        status: 'SELESAI',
      },
      include: { items: true },
      orderBy: { tanggal: 'asc' },
    })

    const menuIds = [...new Set(transaksis.flatMap((transaksi) => transaksi.items.map((item) => item.menuId)))]
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds }, warungId },
      select: { id: true, category: { select: { nama: true } } },
    })
    const kategoriMap = new Map(menus.map((menu) => [menu.id, normalizeKategoriNama(menu.category?.nama)]))

    // Hitung rekap per menu
    const rekapMap = new Map<string, {
      namaMenu: string
      kategori: string
      qtyTotal: number
      pendapatanTotal: number
    }>()

    let grandTotalQty = 0
    let grandTotalPendapatan = 0

    for (const transaksi of transaksis) {
      grandTotalPendapatan += transaksi.total
      for (const item of transaksi.items) {
        grandTotalQty += item.qty

        const existing = rekapMap.get(item.namaMenu)
        if (existing) {
          existing.qtyTotal += item.qty
          existing.pendapatanTotal += item.subtotal
        } else {
          rekapMap.set(item.namaMenu, {
            namaMenu: item.namaMenu,
            kategori: kategoriMap.get(item.menuId) ?? TANPA_KATEGORI,
            qtyTotal: item.qty,
            pendapatanTotal: item.subtotal,
          })
        }
      }
    }

    const rekap = Array.from(rekapMap.values()).sort((a, b) => {
      const categoryOrder = compareIndonesian(a.kategori, b.kategori)
      return categoryOrder || compareIndonesian(a.namaMenu, b.namaMenu)
    })

    // Buat PDF
    const pdfDoc = await PDFDocument.create()
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const page = pdfDoc.addPage([595.28, 841.89]) // A4 size
    const { width, height } = page.getSize()

    // Header
    page.drawText('LAPORAN PENJUALAN', {
      x: width / 2 - 100,
      y: height - 50,
      size: 18,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    })

    page.drawText(warung?.nama || 'Semua Warung', {
      x: width / 2 - 120,
      y: height - 75,
      size: 12,
      font: helveticaFont,
      color: rgb(0.2, 0.2, 0.2),
    })

    page.drawText(`Periode: ${startDate.toISOString().split('T')[0]} s/d ${endDate.toISOString().split('T')[0]}`, {
      x: width / 2 - 100,
      y: height - 95,
      size: 10,
      font: helveticaFont,
      color: rgb(0.4, 0.4, 0.4),
    })

    // Garis pemisah
    page.drawLine({
      start: { x: 50, y: height - 110 },
      end: { x: width - 50, y: height - 110 },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    })

    // Tabel Rekap
    let y = height - 140
    const tableHeaders = ['Menu', 'Kategori', 'Qty', 'Pendapatan']
    const columnWidths = [200, 100, 80, 120]
    const startX = 50

    // Header tabel
    page.drawText(tableHeaders[0], { x: startX, y, size: 10, font: helveticaBold })
    page.drawText(tableHeaders[1], { x: startX + columnWidths[0], y, size: 10, font: helveticaBold })
    page.drawText(tableHeaders[2], { x: startX + columnWidths[0] + columnWidths[1], y, size: 10, font: helveticaBold })
    page.drawText(tableHeaders[3], { x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], y, size: 10, font: helveticaBold })

    y -= 5
    page.drawLine({
      start: { x: startX, y },
      end: { x: startX + columnWidths.reduce((a, b) => a + b, 0), y },
      thickness: 0.5,
      color: rgb(0.5, 0.5, 0.5),
    })
    y -= 15

    // Data tabel
    for (const item of rekap) {
      if (y < 100) {
        // Halaman baru jika terlalu dekat dengan bawah
        const newPage = pdfDoc.addPage([595.28, 841.89])
        y = newPage.getSize().height - 50
      }

      page.drawText(item.namaMenu.substring(0, 30), { x: startX, y, size: 9, font: helveticaFont })
      page.drawText(item.kategori, { x: startX + columnWidths[0], y, size: 9, font: helveticaFont })
      page.drawText(item.qtyTotal.toString(), { x: startX + columnWidths[0] + columnWidths[1], y, size: 9, font: helveticaFont })
      page.drawText(`Rp ${item.pendapatanTotal.toLocaleString('id-ID')}`, { x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], y, size: 9, font: helveticaFont })

      y -= 18
    }

    // Garis pemisah
    y -= 5
    page.drawLine({
      start: { x: startX, y },
      end: { x: startX + columnWidths.reduce((a, b) => a + b, 0), y },
      thickness: 0.5,
      color: rgb(0.5, 0.5, 0.5),
    })
    y -= 15

    // Total
    page.drawText('TOTAL', { x: startX, y, size: 10, font: helveticaBold })
    page.drawText(grandTotalQty.toString(), { x: startX + columnWidths[0] + columnWidths[1], y, size: 10, font: helveticaBold })
    page.drawText(`Rp ${grandTotalPendapatan.toLocaleString('id-ID')}`, { x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], y, size: 10, font: helveticaBold })

    // Footer
    y -= 30
    page.drawText(`Jumlah Transaksi: ${transaksis.length}`, { x: startX, y, size: 9, font: helveticaFont })
    y -= 15
    page.drawText(`Dicetak: ${new Date().toLocaleString('id-ID')}`, { x: startX, y, size: 9, font: helveticaFont })

    // Generate buffer
    const pdfBytes = await pdfDoc.save()

    // Return file
    const filename = `laporan-${warung?.kode || 'all'}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}.pdf`
    
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('[GET /api/laporan/export/pdf]', error)
    return NextResponse.json({ success: false, message: 'Gagal export laporan PDF.' }, { status: 500 })
  }
}
