import { prisma } from '@/lib/prisma'
import { getKasirSessionState } from '@/lib/kasir-session'
import { getStoreDateKey } from '@/lib/time'
import { getSession } from '@/lib/session'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import AutoRefresh from '@/components/AutoRefresh'
import LaporanClient from './LaporanClient'

export const metadata = {
  title: 'Laporan Harian & Tutup Kasir — Kasir Vian Jaya 08',
  description: 'Rekapitulasi penjualan harian dan penutupan shift kasir.',
}

export default async function LaporanPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const warungs = await prisma.warung.findMany({
    where: session.role === 'KASIR' ? { id: session.warungId ?? undefined } : undefined,
    orderBy: { nama: 'asc' },
    select: { id: true, nama: true, kode: true },
  })
  const defaultWarung = warungs[0]

  if (!defaultWarung) {
    return (
      <div className="app-container">
        <div className="content-area" style={{ padding: '3rem', textAlign: 'center' }}>
          <p>Warung tidak ditemukan.</p>
        </div>
      </div>
    )
  }

  const state = await getKasirSessionState(prisma, defaultWarung.id, session.id)
  const isOwnerView = session.role === 'OWNER'
  // The owner reads the whole outlet; a cashier only sees their own shift.
  const transaksiWhere = {
    warungId: defaultWarung.id,
    ...(isOwnerView ? {} : { kasirId: session.id }),
    createdAt: { gte: state.dayStart, lt: state.dayEnd },
    status: 'SELESAI' as const,
  }

  const transaksis = await prisma.transaksi.findMany({
    where: transaksiWhere,
    include: { items: true },
  })

  const aktivitasKasir = await prisma.activityLog.findMany({
    where: {
      warungId: defaultWarung.id,
      ...(isOwnerView ? {} : { userId: session.id }),
      createdAt: { gte: state.today, lt: state.tomorrow },
      aktivitas: { in: ['LOGIN', 'BUKA_KASIR', 'TUTUP_KASIR'] },
    },
    include: { user: { select: { namaLengkap: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const uniqueMenuIds = [...new Set(transaksis.flatMap(t => t.items.map(i => i.menuId)))]
  const menuCategories = await prisma.menu.findMany({
    where: { id: { in: uniqueMenuIds }, warungId: defaultWarung.id },
    select: { id: true, category: { select: { nama: true } } },
  })
  const kategoriMap = new Map(menuCategories.map(m => [m.id, m.category?.nama || 'Lainnya']))

  const rekapMap = new Map<string, { namaMenu: string; kategori: string; qtyTotal: number; pendapatanTotal: number }>()
  let grandTotalQty = 0
  let grandTotalPendapatan = 0
  let totalCash = 0
  let totalQRIS = 0
  let totalTransfer = 0

  for (const transaksi of transaksis) {
    grandTotalPendapatan += transaksi.total
    if (transaksi.metodePembayaran === 'QRIS') totalQRIS += transaksi.total
    else if (transaksi.metodePembayaran === 'TRANSFER') totalTransfer += transaksi.total
    else totalCash += transaksi.total
    for (const item of transaksi.items) {
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
    if (a.kategori !== b.kategori) return a.kategori === 'MAKANAN' ? -1 : 1
    return a.namaMenu.localeCompare(b.namaMenu)
  })

  const laporanData = {
    tanggal: getStoreDateKey(),
    warung: { id: defaultWarung.id, nama: defaultWarung.nama, kode: defaultWarung.kode, alamat: null },
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
    aktivitasKasir: aktivitasKasir.map((a) => ({
      waktu: a.createdAt.toISOString(),
      kasir: a.user.namaLengkap || a.user.username,
      aktivitas: a.aktivitas,
      detail: a.detail,
    })),
  }

  const kasirSesi = state.isClosed && state.latest
    ? {
        ditutupPada: state.latest.ditutupPada.toISOString(),
        ditutupOleh: 'Kasir',
        totalTransaksi: state.latest.totalTransaksi,
        totalPendapatan: state.latest.totalPendapatan,
      }
    : null

  const role = session?.role === 'OWNER' ? 'OWNER' : 'KASIR'

  return (
    <div className="app-container">
      <AutoRefresh />
      <Navbar
        session={{
          warungNama: defaultWarung.nama,
          warungKode: defaultWarung.kode,
          namaLengkap: session?.namaLengkap ?? defaultWarung.nama,
          username: session?.username ?? defaultWarung.kode,
          role,
        }}
        activePage="laporan"
      />
      <div className="content-area">
        <LaporanClient
          warungId={defaultWarung.id}
          warungNama={defaultWarung.nama}
          warungKode={defaultWarung.kode}
          warungs={warungs}
          role={role}
          initialData={laporanData}
          initialKasirSesi={kasirSesi}
        />
      </div>
    </div>
  )
}
