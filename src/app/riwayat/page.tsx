import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Navbar from '@/components/Navbar'
import RiwayatClient from './RiwayatClient'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'
import { compareIndonesian } from '@/lib/menu-sort'
import { normalizeKategoriNama, TANPA_KATEGORI } from '@/lib/kategori'

export const metadata = {
  title: `Riwayat Laporan Harian — ${DEFAULT_BRANCH_NAME}`,
  description: 'Riwayat sesi kasir (buka/tutup) dan laporan keuangan harian.',
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
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(mulai || '') ? new Date(`${mulai}T00:00:00.000Z`) : undefined
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(sampai || '') ? new Date(`${sampai}T00:00:00.000Z`) : undefined
  const tanggalFilter = startDate || endDate ? { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } : undefined

  const kasirSesis = await prisma.kasirSesi.findMany({
    where: {
      warungId: session.warungId ?? undefined,
      ...(session.role === 'KASIR' ? { ditutupOleh: session.id } : {}),
      ...(tanggalFilter ? { tanggal: tanggalFilter } : {}),
    },
    include: {
      user: { select: { namaLengkap: true, username: true } },
      warung: { select: { nama: true, kode: true, alamat: true } },
    },
    orderBy: [{ tanggal: 'desc' }, { ditutupPada: 'desc' }],
  })

  const serializedSesis = await Promise.all(kasirSesis.map(async (s) => {
    // Determine the effective time range for this session's transactions.
    //
    // Data model:
    // - Buka-created sesi: ditutupPada = now() (default), totalTransaksi/totalPendapatan = 0
    //   → represents the "kasir opened" event, not a real session with transactions
    // - Tutup-created sesi: ditutupPada = actual close time, has real totals
    //   → this is a real session; dibukaKembaliPada is set by the NEXT buka call
    //
    // For a tutup-created sesi S:
    //   Start = the dibukaKembaliPada of the session BEFORE S
    //          (which marks when THIS session was opened)
    //   End   = S.ditutupPada (when THIS session was closed)

    const isTutupSesi = s.totalTransaksi > 0 || s.totalPendapatan > 0

    let effectiveStart: Date
    let effectiveEnd: Date

    if (isTutupSesi) {
      // Find the immediately previous sesi for same warung+day
      const previousSesi = await prisma.kasirSesi.findFirst({
        where: {
          warungId: s.warungId,
          ditutupOleh: s.ditutupOleh,
          tanggal: s.tanggal,
          ditutupPada: { lt: s.ditutupPada },
        },
        orderBy: { ditutupPada: 'desc' },
      })
      // Start = when this session was opened (dibukaKembaliPada of previous sesi, or midnight for first session)
      effectiveStart = s.dibukaPada ?? previousSesi?.dibukaPada ?? previousSesi?.dibukaKembaliPada ?? s.tanggal
      // End = this session's ditutupPada (exact close time)
      effectiveEnd = s.ditutupPada
    } else {
      // Buka-only sesi (no transactions yet) — show empty
      effectiveStart = s.ditutupPada
      effectiveEnd = s.ditutupPada
    }

    const transaksisSesi = await prisma.transaksi.findMany({
      where: {
        warungId: s.warungId,
        createdAt: { gte: effectiveStart, lte: effectiveEnd },
        status: 'SELESAI',
      },
      include: { items: true },
    })

    const uniqueMenuIds = [...new Set(transaksisSesi.flatMap(t => t.items.map(i => i.menuId)))]
    const menuCategories = await prisma.menu.findMany({
      where: { id: { in: uniqueMenuIds }, warungId: s.warungId },
      select: { id: true, category: { select: { nama: true } } },
    })
    const kategoriMap = new Map(menuCategories.map(m => [m.id, normalizeKategoriNama(m.category?.nama)]))

    const rekapMap = new Map<string, { namaMenu: string; kategori: string; qtyTotal: number; pendapatanTotal: number }>()
    let grandTotalQty = 0
    let grandTotalPendapatan = 0
    let totalCash = 0
    let totalQRIS = 0
    let totalTransfer = 0

    for (const tx of transaksisSesi) {
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
      id: s.id,
      tanggal: s.tanggal.toISOString().split('T')[0],
      ditutupPada: s.ditutupPada.toISOString(),
      dibukaPada: s.dibukaPada?.toISOString() ?? null,
      dibukaKembaliPada: s.dibukaKembaliPada?.toISOString() ?? null,
      ditutupOleh: s.user.namaLengkap || s.user.username,
      totalTransaksi: transaksisSesi.length > 0 ? transaksisSesi.length : s.totalTransaksi,
      totalPendapatan: grandTotalPendapatan > 0 ? grandTotalPendapatan : s.totalPendapatan,
      warungNama: s.warung.nama,
      warungKode: s.warung.kode,
      warungAlamat: s.warung.alamat,
      detail: {
        rekap,
        transaksi: transaksisSesi.map(t => ({
          nomorMeja: t.nomorMeja,
          total: t.total,
          metodePembayaran: t.metodePembayaran || 'CASH',
          createdAt: t.createdAt.toISOString(),
        })),
        grandTotalQty,
        totalCash,
        totalQRIS,
        totalTransfer,
        jumlahTransaksi: transaksisSesi.length,
      },
    }
  }))

  return (
    <div className="app-container">
      <Navbar session={session} activePage="riwayat" />
      <div className="content-area">
        <RiwayatClient session={session} initialKasirSesis={serializedSesis} initialStartDate={mulai} initialEndDate={sampai} />
      </div>
    </div>
  )
}
