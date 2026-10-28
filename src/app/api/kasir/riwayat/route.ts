import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { compareIndonesian } from '@/lib/menu-sort'
import { normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'
import { personName } from '@/lib/kasir-shift'
import { getStoreDateKey, getStoreDayRangeForDateKey } from '@/lib/time'

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
        warungId = context.warungId ?? null
      } else {
        return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
      }
    } else {
      warungId = warungIdParam
    }

    if (!warungId) {
      return NextResponse.json({ success: false, message: 'warungId wajib diisi.' }, { status: 400 })
    }

    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(mulai || '') ? getStoreDayRangeForDateKey(mulai!).today : undefined
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(sampai || '') ? getStoreDayRangeForDateKey(sampai!).tomorrow : undefined
    const shiftDateFilter = startDate || endDate
      ? { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lt: endDate } : {}) }
      : undefined

    const shifts = await prisma.kasirShift.findMany({
      where: {
        warungId,
        ...(context?.user.role === 'KASIR' ? { OR: [{ dibukaOleh: context.user.id }, { ditutupOleh: context.user.id }] } : {}),
        ...(shiftDateFilter ? { dibukaPada: shiftDateFilter } : {}),
      },
      include: {
        pembuka: { select: { namaLengkap: true, username: true } },
        penutup: { select: { namaLengkap: true, username: true } },
        warung: { select: { nama: true, kode: true, alamat: true } },
        transaksis: {
          where: { status: 'SELESAI' },
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ dibukaPada: 'desc' }, { createdAt: 'desc' }],
    })

    const uniqueMenuIds = [...new Set(shifts.flatMap((shift) => shift.transaksis.flatMap((transaction) => transaction.items.map((item) => item.menuId))))]
    const menuCategories = uniqueMenuIds.length > 0
      ? await prisma.menu.findMany({
          where: { id: { in: uniqueMenuIds }, warungId },
          select: { id: true, category: { select: { nama: true } } },
        })
      : []
    const kategoriMap = new Map(menuCategories.map((menu) => [menu.id, normalizeKategoriNama(menu.category?.nama)]))

    const data = shifts.map((shift) => {
      const rekapMap = new Map<string, { namaMenu: string; kategori: string; qtyTotal: number; pendapatanTotal: number }>()
      let grandTotalQty = 0
      let totalCash = 0
      let totalQRIS = 0
      let totalTransfer = 0

      for (const tx of shift.transaksis) {
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
      const totalPendapatan = shift.transaksis.reduce((sum, transaction) => sum + transaction.total, 0)

      return {
        id: shift.id,
        tanggal: getStoreDateKey(shift.dibukaPada ?? shift.createdAt),
        status: shift.status,
        ditutupPada: shift.ditutupPada?.toISOString() ?? null,
        dibukaPada: shift.dibukaPada?.toISOString() ?? null,
        dibukaOleh: personName(shift.pembuka),
        ditutupOleh: shift.penutup ? personName(shift.penutup) : null,
        totalTransaksi: shift.transaksis.length,
        totalPendapatan,
        warungNama: shift.warung.nama,
        warungKode: shift.warung.kode,
        warungAlamat: shift.warung.alamat,
        detail: {
          rekap,
          transaksi: shift.transaksis.map((transaction) => ({
            nomorMeja: transaction.nomorMeja,
            total: transaction.total,
            metodePembayaran: transaction.metodePembayaran || 'CASH',
            createdAt: transaction.createdAt.toISOString(),
          })),
          grandTotalQty,
          totalCash,
          totalQRIS,
          totalTransfer,
          jumlahTransaksi: shift.transaksis.length,
        },
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[GET /api/kasir/riwayat]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil riwayat kasir.' }, { status: 500 })
  }
}
