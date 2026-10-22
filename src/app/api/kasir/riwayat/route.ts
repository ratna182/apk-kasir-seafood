import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { compareIndonesian } from '@/lib/menu-sort'

export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const { searchParams } = new URL(request.url)
    const warungIdParam = searchParams.get('warung_id')
    const mulai = searchParams.get('mulai')
    const sampai = searchParams.get('sampai')

    let warungId: string | null = null

    if (context) {
      if (requireRole(context, 'OWNER') === null) {
        warungId = warungIdParam
      } else if (requireRole(context, 'KASIR') === null) {
        warungId = context?.warungId ?? null
      } else {
        return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
      }
    } else {
      warungId = warungIdParam
    }

    if (!warungId) {
      return NextResponse.json({ success: false, message: 'warungId wajib diisi.' }, { status: 400 })
    }

    const where: Record<string, unknown> = { warungId }
    if (context?.user.role === 'KASIR') where.ditutupOleh = context.user.id

    if (/^\d{4}-\d{2}-\d{2}$/.test(mulai || '') || /^\d{4}-\d{2}-\d{2}$/.test(sampai || '')) {
      const tanggalFilter: Record<string, Date> = {}
      if (mulai) tanggalFilter.gte = new Date(`${mulai}T00:00:00.000Z`)
      if (sampai) tanggalFilter.lte = new Date(`${sampai}T23:59:59.999Z`)
      where.tanggal = tanggalFilter
    }

    const sessions = await prisma.kasirSesi.findMany({
      where,
      include: {
        user: { select: { namaLengkap: true, username: true } },
        warung: { select: { nama: true, kode: true, alamat: true } },
      },
      orderBy: [{ tanggal: 'desc' }, { ditutupPada: 'desc' }],
    })

    if (sessions.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const transaksis = await prisma.transaksi.findMany({
      where: {
        warungId,
        status: 'SELESAI',
        OR: sessions.map((session) => ({
          kasirId: session.ditutupOleh,
          createdAt: { gte: session.tanggal, lte: session.ditutupPada },
        })),
      },
      include: { items: true },
    })
    const uniqueMenuIds = [...new Set(transaksis.flatMap((transaction) => transaction.items.map((item) => item.menuId)))]
    const menuCategories = await prisma.menu.findMany({
      where: { id: { in: uniqueMenuIds }, warungId },
      select: { id: true, category: { select: { nama: true } } },
    })
    const kategoriMap = new Map(menuCategories.map((menu) => [menu.id, menu.category?.nama || 'Lainnya']))

    const data = sessions.map((s) => {
      const sessionStart = s.tanggal
      const sessionEnd = s.ditutupPada
      const sessionTransaksis = transaksis.filter((transaction) =>
        transaction.kasirId === s.ditutupOleh &&
        transaction.createdAt >= sessionStart &&
        transaction.createdAt <= sessionEnd,
      )

      const rekapMap = new Map<string, { namaMenu: string; kategori: string; qtyTotal: number; pendapatanTotal: number }>()
      let grandTotalQty = 0
      let totalCash = 0
      let totalQRIS = 0
      let totalTransfer = 0

      for (const tx of sessionTransaksis) {
        if (tx.metodePembayaran === 'QRIS') totalQRIS += tx.total
        else if (tx.metodePembayaran === 'TRANSFER') totalTransfer += tx.total
        else totalCash += tx.total

        for (const item of tx.items) {
          grandTotalQty += item.qty
          const existing = rekapMap.get(item.namaMenu)
          if (existing) {
            existing.qtyTotal += item.qty
            existing.pendapatanTotal += item.subtotal
          } else {
            rekapMap.set(item.namaMenu, {
              namaMenu: item.namaMenu,
              kategori: kategoriMap.get(item.menuId) || 'MAKANAN',
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

      return {
        id: s.id,
        tanggal: s.tanggal.toISOString().split('T')[0],
        ditutupPada: s.ditutupPada.toISOString(),
        dibukaKembaliPada: s.dibukaKembaliPada?.toISOString() ?? null,
        ditutupOleh: s.user.namaLengkap || s.user.username,
        totalTransaksi: s.totalTransaksi,
        totalPendapatan: s.totalPendapatan,
        warungNama: s.warung.nama,
        warungKode: s.warung.kode,
        warungAlamat: s.warung.alamat,
        detail: {
          rekap,
          transaksi: sessionTransaksis.map(t => ({
            nomorMeja: t.nomorMeja,
            total: t.total,
            metodePembayaran: t.metodePembayaran || 'CASH',
            createdAt: t.createdAt.toISOString(),
          })),
          grandTotalQty,
          totalCash,
          totalQRIS,
          totalTransfer,
          jumlahTransaksi: sessionTransaksis.length,
        },
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[GET /api/kasir/riwayat]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil riwayat kasir.' }, { status: 500 })
  }
}
