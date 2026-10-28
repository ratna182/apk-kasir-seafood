import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, isOwner, requireWarungAccess } from '@/lib/auth'
import { buildLaporanHarian } from '@/lib/laporan-shift'
import { getStoreDateKey, formatWibShortDateTime } from '@/lib/time'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// GET /api/laporan/export/pdf — export laporan harian (per shift) ke PDF
// Query params: warung_id (required untuk owner), tanggal (YYYY-MM-DD, default hari ini WIB)
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

    const dateKey = searchParams.get('tanggal')?.trim() || getStoreDateKey()
    const laporan = await buildLaporanHarian(prisma, warungId, dateKey)

    const pdfDoc = await PDFDocument.create()
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const page = pdfDoc.addPage([595.28, 841.89])
    const { width, height } = page.getSize()

    page.drawText('LAPORAN PENJUALAN HARIAN', {
      x: width / 2 - 110,
      y: height - 50,
      size: 18,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    })

    page.drawText(laporan.warung.nama || 'Semua Warung', {
      x: width / 2 - 120,
      y: height - 75,
      size: 12,
      font: helveticaFont,
      color: rgb(0.2, 0.2, 0.2),
    })

    page.drawText(`Tanggal laporan: ${dateKey} (WIB)`, {
      x: width / 2 - 100,
      y: height - 95,
      size: 10,
      font: helveticaFont,
      color: rgb(0.4, 0.4, 0.4),
    })

    page.drawLine({
      start: { x: 50, y: height - 110 },
      end: { x: width - 50, y: height - 110 },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    })

    let y = height - 135
    page.drawText('SHIFT', { x: 50, y, size: 11, font: helveticaBold })
    y -= 16
    for (const shift of laporan.shifts) {
      if (y < 80) break
      const buka = shift.dibukaPada ? formatWibShortDateTime(new Date(shift.dibukaPada)) : '-'
      const tutup = shift.ditutupPada
        ? formatWibShortDateTime(new Date(shift.ditutupPada))
        : shift.status === 'TERBUKA' ? 'masih buka' : '-'
      const line = `${shift.label}: Buka ${buka}, Tutup ${tutup} WIB — ${shift.dibukaOleh}${shift.ditutupOleh ? ` / ${shift.ditutupOleh}` : ''}`
      page.drawText(line.substring(0, 100), { x: 50, y, size: 9, font: helveticaFont })
      y -= 13
      page.drawText(
        `  ${shift.totalTransaksi} transaksi, Rp ${shift.totalPendapatan.toLocaleString('id-ID')}${shift.overtime ? ' (OVERTIME)' : ''}`,
        { x: 50, y, size: 9, font: helveticaFont, color: rgb(0.35, 0.35, 0.35) },
      )
      y -= 14
    }

    y -= 8
    page.drawText('REKAP MENU', { x: 50, y, size: 11, font: helveticaBold })
    y -= 20

    const tableHeaders = ['Menu', 'Kategori', 'Qty', 'Pendapatan']
    const columnWidths = [200, 100, 80, 120]
    const startX = 50

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

    let currentPage = page
    for (const item of laporan.rekap) {
      if (y < 100) {
        currentPage = pdfDoc.addPage([595.28, 841.89])
        y = currentPage.getSize().height - 50
      }

      currentPage.drawText(item.namaMenu.substring(0, 30), { x: startX, y, size: 9, font: helveticaFont })
      currentPage.drawText(item.kategori.substring(0, 20), { x: startX + columnWidths[0], y, size: 9, font: helveticaFont })
      currentPage.drawText(item.qtyTotal.toString(), { x: startX + columnWidths[0] + columnWidths[1], y, size: 9, font: helveticaFont })
      currentPage.drawText(`Rp ${item.pendapatanTotal.toLocaleString('id-ID')}`, { x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], y, size: 9, font: helveticaFont })

      y -= 18
    }

    if (y < 100) {
      currentPage = pdfDoc.addPage([595.28, 841.89])
      y = currentPage.getSize().height - 60
    }

    y -= 5
    currentPage.drawLine({
      start: { x: startX, y },
      end: { x: startX + columnWidths.reduce((a, b) => a + b, 0), y },
      thickness: 0.5,
      color: rgb(0.5, 0.5, 0.5),
    })
    y -= 15

    currentPage.drawText('TOTAL', { x: startX, y, size: 10, font: helveticaBold })
    currentPage.drawText(laporan.grandTotalQty.toString(), { x: startX + columnWidths[0] + columnWidths[1], y, size: 10, font: helveticaBold })
    currentPage.drawText(`Rp ${laporan.grandTotalPendapatan.toLocaleString('id-ID')}`, { x: startX + columnWidths[0] + columnWidths[1] + columnWidths[2], y, size: 10, font: helveticaBold })

    y -= 30
    currentPage.drawText(`Jumlah Transaksi: ${laporan.jumlahTransaksi}`, { x: startX, y, size: 9, font: helveticaFont })
    y -= 15
    currentPage.drawText(`Dicetak: ${new Date().toLocaleString('id-ID')}`, { x: startX, y, size: 9, font: helveticaFont })

    const pdfBytes = await pdfDoc.save()
    const filename = `laporan-${laporan.warung.kode || 'all'}-${dateKey}.pdf`

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('[GET /api/laporan/export/pdf]', error)
    if (error instanceof Error && error.message.startsWith('Format tanggal')) {
      return NextResponse.json({ success: false, message: error.message }, { status: 422 })
    }
    return NextResponse.json({ success: false, message: 'Gagal export laporan PDF.' }, { status: 500 })
  }
}
