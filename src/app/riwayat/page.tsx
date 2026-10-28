import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Navbar from '@/components/Navbar'
import RiwayatClient from './RiwayatClient'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'
import { compareIndonesian } from '@/lib/menu-sort'
import { normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'
import { personName } from '@/lib/kasir-shift'
import { getStoreDateKey, getStoreDayRangeForDateKey } from '@/lib/time'

export const metadata = {
  title: `Riwayat Laporan Harian — ${DEFAULT_BRANCH_NAME}`,
  description: 'Riwayat shift kasir (buka/tutup) dan laporan keuangan harian.',
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RiwayatPage({
  searchParams,
}: {
  searchParams: Promise<{ mulai?: string; sampai?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { mulai, sampai } = await searchParams
  const startRange = mulai && /^\d{4}-\d{2}-\d{2}$/.test(mulai) ? getStoreDayRangeForDateKey(mulai) : null
  const endRange = sampai && /^\d{4}-\d{2}-\d{2}$/.test(sampai) ? getStoreDayRangeForDateKey(sampai) : null
  const shiftDateFilter = startRange || endRange
    ? {
        ...(startRange ? { gte: startRange.today } : {}),
        ...(endRange ? { lt: endRange.tomorrow } : {}),
      }
    : undefined

  const shifts = await prisma.kasirShift.findMany({
    where: {
      warungId: session.warungId ?? undefined,
      ...(session.role === 'KASIR' ? { OR: [{ dibukaOleh: session.id }, { ditutupOleh: session.id }] } : {}),
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

  const allMenuIds = [...new Set(shifts.flatMap((shift) => shift.transaksis.flatMap((tx) => tx.items.map((item) => item.menuId))))]
  const menuCategories = allMenuIds.length > 0
    ? await prisma.menu.findMany({
        where: { id: { in: allMenuIds }, ...(session.warungId ? { warungId: session.warungId } : {}) },
        select: { id: true, category: { select: { nama: true } } },
      })
    : []
  const kategoriMap = new Map(menuCategories.map((menu) => [menu.id, normalizeKategoriNama(menu.category?.nama)]))

  const serializedSesis = shifts.map((shift) => {
    const rekapMap = new Map<string, { namaMenu: string; kategori: string; qtyTotal: number; pendapatanTotal: number }>()
    let grandTotalQty = 0
    let grandTotalPendapatan = 0
    let totalCash = 0
    let totalQRIS = 0
    let totalTransfer = 0

    for (const tx of shift.transaksis) {
      grandTotalPendapatan += tx.total
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

    return {
      id: shift.id,
      tanggal: getStoreDateKey(shift.dibukaPada ?? shift.createdAt),
      status: shift.status,
      ditutupPada: shift.ditutupPada?.toISOString() ?? null,
      dibukaPada: shift.dibukaPada?.toISOString() ?? null,
      dibukaKembaliPada: null,
      dibukaOleh: personName(shift.pembuka),
      ditutupOleh: shift.penutup ? personName(shift.penutup) : null,
      totalTransaksi: shift.transaksis.length,
      totalPendapatan: grandTotalPendapatan,
      warungNama: shift.warung.nama,
      warungKode: shift.warung.kode,
      warungAlamat: shift.warung.alamat,
      detail: {
        rekap,
        transaksi: shift.transaksis.map((t) => ({
          nomorMeja: t.nomorMeja,
          total: t.total,
          metodePembayaran: t.metodePembayaran || 'CASH',
          createdAt: t.createdAt.toISOString(),
        })),
        grandTotalQty,
        totalCash,
        totalQRIS,
        totalTransfer,
        jumlahTransaksi: shift.transaksis.length,
      },
    }
  })

  return (
    <div className="app-container">
      <Navbar session={session} activePage="riwayat" />
      <div className="content-area">
        <RiwayatClient session={session} initialKasirSesis={serializedSesis} initialStartDate={mulai} initialEndDate={sampai} />
      </div>
    </div>
  )
}
