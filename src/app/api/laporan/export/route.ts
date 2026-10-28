import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'
import { getAuthContext, isOwner, requireWarungAccess } from '@/lib/auth'
import { buildLaporanHarian } from '@/lib/laporan-shift'
import { getStoreDateKey, getStoreDayRangeForDateKey, formatWibShortDateTime } from '@/lib/time'
import { normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'
import ExcelJS from 'exceljs'

// GET /api/laporan/export — export laporan harian (per shift) ke Excel
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
    const day = getStoreDayRangeForDateKey(dateKey)
    const laporan = await buildLaporanHarian(prisma, warungId, dateKey)

    const shiftIds = laporan.shifts.map((shift) => shift.id).filter((id) => id !== 'legacy')
    const transaksis = await prisma.transaksi.findMany({
      where: {
        warungId,
        status: 'SELESAI',
        OR: [
          ...(shiftIds.length > 0 ? [{ shiftId: { in: shiftIds } }] : []),
          { shiftId: null, createdAt: { gte: day.today, lt: day.tomorrow } },
        ],
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    })

    const menuIds = [...new Set(transaksis.flatMap((transaksi) => transaksi.items.map((item) => item.menuId)))]
    const menus = await prisma.menu.findMany({
      where: { id: { in: menuIds }, warungId },
      select: { id: true, category: { select: { nama: true } } },
    })
    const kategoriMap = new Map(menus.map((menu) => [menu.id, normalizeKategoriNama(menu.category?.nama)]))
    const shiftLabel = new Map(laporan.shifts.map((shift) => [shift.id, shift.label]))

    const workbook = new ExcelJS.Workbook()
    workbook.creator = DEFAULT_BRANCH_NAME
    workbook.created = new Date()

    const dailySheet = workbook.addWorksheet('Rekap Shift')
    dailySheet.columns = [
      { header: 'Tanggal', key: 'tanggal', width: 14 },
      { header: 'Shift', key: 'shift', width: 14 },
      { header: 'Buka', key: 'buka', width: 18 },
      { header: 'Tutup', key: 'tutup', width: 18 },
      { header: 'Kasir Buka', key: 'pembuka', width: 20 },
      { header: 'Kasir Tutup', key: 'penutup', width: 20 },
      { header: 'Jumlah Transaksi', key: 'jumlahTransaksi', width: 18 },
      { header: 'Total Pendapatan', key: 'totalPendapatan', width: 20 },
    ]
    dailySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    dailySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }

    for (const shift of laporan.shifts) {
      dailySheet.addRow({
        tanggal: dateKey,
        shift: shift.label,
        buka: shift.dibukaPada ? formatWibShortDateTime(new Date(shift.dibukaPada)) : '-',
        tutup: shift.ditutupPada ? formatWibShortDateTime(new Date(shift.ditutupPada)) : (shift.status === 'TERBUKA' ? 'Masih buka' : '-'),
        pembuka: shift.dibukaOleh,
        penutup: shift.ditutupOleh ?? '-',
        jumlahTransaksi: shift.totalTransaksi,
        totalPendapatan: shift.totalPendapatan,
      })
    }
    const totalRow = dailySheet.addRow({
      tanggal: 'TOTAL',
      shift: '',
      buka: '',
      tutup: '',
      pembuka: '',
      penutup: '',
      jumlahTransaksi: laporan.jumlahTransaksi,
      totalPendapatan: laporan.grandTotalPendapatan,
    })
    totalRow.font = { bold: true }

    const detailSheet = workbook.addWorksheet('Detail Transaksi')
    detailSheet.columns = [
      { header: 'ID Transaksi', key: 'id', width: 36 },
      { header: 'Waktu', key: 'waktu', width: 18 },
      { header: 'Shift', key: 'shift', width: 22 },
      { header: 'Meja', key: 'meja', width: 10 },
      { header: 'Menu', key: 'menu', width: 30 },
      { header: 'Kategori', key: 'kategori', width: 20 },
      { header: 'Qty', key: 'qty', width: 8 },
      { header: 'Harga Satuan', key: 'harga', width: 15 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Total Transaksi', key: 'totalTransaksi', width: 18 },
    ]
    detailSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    detailSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }

    for (const transaksi of transaksis) {
      for (const item of transaksi.items) {
        detailSheet.addRow({
          id: transaksi.id,
          waktu: formatWibShortDateTime(transaksi.createdAt),
          shift: transaksi.shiftId ? shiftLabel.get(transaksi.shiftId) ?? '-' : 'Tanpa shift (data lama)',
          meja: transaksi.nomorMeja,
          menu: item.namaMenu,
          kategori: kategoriMap.get(item.menuId) ?? TANPA_KATEGORI,
          qty: item.qty,
          harga: item.hargaSatuan,
          subtotal: item.subtotal,
          totalTransaksi: transaksi.total,
        })
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const filename = `laporan-${laporan.warung.kode || 'all'}-${dateKey}.xlsx`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('[GET /api/laporan/export]', error)
    if (error instanceof Error && error.message.startsWith('Format tanggal')) {
      return NextResponse.json({ success: false, message: error.message }, { status: 422 })
    }
    return NextResponse.json({ success: false, message: 'Gagal export laporan.' }, { status: 500 })
  }
}
