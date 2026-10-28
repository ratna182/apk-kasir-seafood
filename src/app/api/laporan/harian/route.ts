import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, isOwner, requireWarungAccess } from '@/lib/auth'
import { getKasirSessionState } from '@/lib/kasir-session'
import { getStoreDateKey } from '@/lib/time'
import { compareIndonesian } from '@/lib/menu-sort'
import { normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'

// GET /api/laporan/harian — rekap penjualan hari ini per menu
// Query params: warung_id (required untuk owner, optional untuk kasir)
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

    const isOwnerView = isOwner(context)
    const kasirId = isOwnerView ? null : context.user.id
    const state = await getKasirSessionState(prisma, warungId, context.user.id)

    const transaksis = await prisma.transaksi.findMany({
      where: {
        warungId,
        // The owner sees the whole outlet, so transactions from every cashier are included.
        ...(kasirId ? { kasirId } : {}),
        createdAt: { gte: state.dayStart, lt: state.dayEnd },
        status: 'SELESAI',
      },
      include: {
        items: true,
      },
    })

    const aktivitasKasir = await prisma.activityLog.findMany({
      where: {
        warungId,
        ...(kasirId ? { userId: kasirId } : {}),
        createdAt: { gte: state.today, lt: state.tomorrow },
        aktivitas: { in: ['LOGIN', 'BUKA_KASIR', 'TUTUP_KASIR'] },
      },
      include: { user: { select: { namaLengkap: true, username: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // Ambil info warung
    const warung = await prisma.warung.findUnique({
      where: { id: warungId },
      select: { id: true, nama: true, kode: true, alamat: true },
    })

    // Rekap per menu - batch fetch semua kategori sekaligus (anti N+1)
    const uniqueMenuIds = [...new Set(transaksis.flatMap(t => t.items.map(i => i.menuId)))]

    const menuCategories = await prisma.menu.findMany({
      where: { id: { in: uniqueMenuIds }, warungId },
      select: { id: true, category: { select: { nama: true } } },
    })
    const kategoriMap = new Map(menuCategories.map(m => [m.id, normalizeKategoriNama(m.category?.nama)]))

    const rekapMap = new Map<string, {
      namaMenu: string
      kategori: string
      qtyTotal: number
      pendapatanTotal: number
    }>()

    let grandTotalQty = 0
    let grandTotalPendapatan = 0
    let totalCash = 0
    let totalQRIS = 0
    let totalTransfer = 0

    for (const transaksi of transaksis) {
      grandTotalPendapatan += transaksi.total
      if (transaksi.metodePembayaran === 'QRIS') {
        totalQRIS += transaksi.total
      } else if (transaksi.metodePembayaran === 'TRANSFER') {
        totalTransfer += transaksi.total
      } else {
        totalCash += transaksi.total
      }
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

    // Sort categories and menu names consistently for the report.
    const rekap = Array.from(rekapMap.values()).sort((a, b) => {
      const categoryOrder = compareIndonesian(a.kategori, b.kategori)
      return categoryOrder || compareIndonesian(a.namaMenu, b.namaMenu)
    })

    return NextResponse.json({
      success: true,
      data: {
        tanggal: getStoreDateKey(),
        warung,
        rekap,
        transaksi: transaksis.map(t => ({
          nomorMeja: t.nomorMeja,
          total: t.total,
          metodePembayaran: t.metodePembayaran || 'CASH',
          createdAt: t.createdAt.toISOString(),
        })),
        grandTotalQty,
        grandTotalPendapatan,
        jumlahTransaksi: transaksis.length,
        totalCash,
        totalQRIS,
        totalTransfer,
        aktivitasKasir: aktivitasKasir.map((aktivitas) => ({
          waktu: aktivitas.createdAt.toISOString(),
          kasir: aktivitas.user.namaLengkap || aktivitas.user.username,
          aktivitas: aktivitas.aktivitas,
          detail: aktivitas.detail,
        })),
      },
    })
  } catch (error) {
    console.error('[GET /api/laporan/harian]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil laporan.' }, { status: 500 })
  }
}
