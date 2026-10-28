import type { Prisma } from '@prisma/client'
import { getStoreDayRangeForDateKey } from './time'
import { isShiftOvertime, personName, shiftDurationHours } from './kasir-shift'
import { compareIndonesian } from './menu-sort'
import { normalizeKategoriNama, TANPA_KATEGORI } from './kategori'

export interface LaporanRekapItem {
  namaMenu: string
  kategori: string
  qtyTotal: number
  pendapatanTotal: number
}

export interface LaporanTransaksiItem {
  nomorMeja: string
  total: number
  metodePembayaran: string
  createdAt: string
  shiftId: string | null
  shiftNomor: number | null
}

export interface LaporanShiftSummary {
  id: string
  nomor: number
  label: string
  status: 'TERBUKA' | 'DITUTUP'
  dibukaPada: string | null
  ditutupPada: string | null
  dibukaOleh: string
  ditutupOleh: string | null
  catatanBuka: string | null
  catatanTutup: string | null
  totalTransaksi: number
  totalPendapatan: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
  jumlahItem: number
  durationHours: number
  overtime: boolean
}

export interface LaporanAktivitasKasir {
  waktu: string
  kasir: string
  aktivitas: string
  detail: string | null
}

export interface LaporanData {
  tanggal: string
  warung: { id: string; nama: string; kode: string; alamat?: string | null }
  shifts: LaporanShiftSummary[]
  rekap: LaporanRekapItem[]
  transaksi: LaporanTransaksiItem[]
  grandTotalQty: number
  grandTotalPendapatan: number
  jumlahTransaksi: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
  aktivitasKasir: LaporanAktivitasKasir[]
}

type LaporanDb = Pick<
  Prisma.TransactionClient,
  'kasirShift' | 'transaksi' | 'menu' | 'warung' | 'activityLog'
>

interface ShiftTransaction {
  id: string
  nomorMeja: string
  total: number
  metodePembayaran: 'CASH' | 'QRIS' | 'TRANSFER' | null
  createdAt: Date
  items: Array<{ menuId: string; namaMenu: string; qty: number; subtotal: number }>
}

function emptyTotals() {
  return { totalCash: 0, totalQRIS: 0, totalTransfer: 0, jumlahItem: 0 }
}

function addTotals(target: ReturnType<typeof emptyTotals>, transaksi: ShiftTransaction) {
  if (transaksi.metodePembayaran === 'QRIS') target.totalQRIS += transaksi.total
  else if (transaksi.metodePembayaran === 'TRANSFER') target.totalTransfer += transaksi.total
  else target.totalCash += transaksi.total
  for (const item of transaksi.items) target.jumlahItem += item.qty
}

export async function buildLaporanHarian(
  db: LaporanDb,
  warungId: string,
  dateKey: string,
): Promise<LaporanData> {
  const day = getStoreDayRangeForDateKey(dateKey)
  const now = new Date()

  const [warung, shiftsRaw, legacyTransactions, aktivitasKasir] = await Promise.all([
    db.warung.findUnique({
      where: { id: warungId },
      select: { id: true, nama: true, kode: true, alamat: true },
    }),
    db.kasirShift.findMany({
      where: {
        warungId,
        dibukaPada: { gte: day.today, lt: day.tomorrow },
      },
      include: {
        pembuka: { select: { namaLengkap: true, username: true } },
        penutup: { select: { namaLengkap: true, username: true } },
        transaksis: {
          where: { status: 'SELESAI' },
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ dibukaPada: 'asc' }, { createdAt: 'asc' }],
    }),
    db.transaksi.findMany({
      where: {
        warungId,
        shiftId: null,
        createdAt: { gte: day.today, lt: day.tomorrow },
        status: 'SELESAI',
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.activityLog.findMany({
      where: {
        warungId,
        createdAt: { gte: day.today, lt: day.tomorrow },
        aktivitas: { in: ['LOGIN', 'BUKA_KASIR', 'TUTUP_KASIR'] },
      },
      include: { user: { select: { namaLengkap: true, username: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const shifts: LaporanShiftSummary[] = []
  const transaksi: LaporanTransaksiItem[] = []
  const allItems: Array<{ menuId: string; namaMenu: string; qty: number; subtotal: number }> = []
  const grand = emptyTotals()
  let grandTotalPendapatan = 0

  shiftsRaw.forEach((shift, index) => {
    const totals = emptyTotals()
    for (const transaction of shift.transaksis as ShiftTransaction[]) {
      addTotals(totals, transaction)
      grandTotalPendapatan += transaction.total
      allItems.push(...transaction.items)
      transaksi.push({
        nomorMeja: transaction.nomorMeja,
        total: transaction.total,
        metodePembayaran: transaction.metodePembayaran || 'CASH',
        createdAt: transaction.createdAt.toISOString(),
        shiftId: shift.id,
        shiftNomor: index + 1,
      })
    }
    grand.totalCash += totals.totalCash
    grand.totalQRIS += totals.totalQRIS
    grand.totalTransfer += totals.totalTransfer
    grand.jumlahItem += totals.jumlahItem

    shifts.push({
      id: shift.id,
      nomor: index + 1,
      label: `Shift ${index + 1}`,
      status: shift.status,
      dibukaPada: shift.dibukaPada?.toISOString() ?? null,
      ditutupPada: shift.ditutupPada?.toISOString() ?? null,
      dibukaOleh: personName(shift.pembuka),
      ditutupOleh: shift.penutup ? personName(shift.penutup) : null,
      catatanBuka: shift.catatanBuka,
      catatanTutup: shift.catatanTutup,
      totalTransaksi: shift.transaksis.length,
      totalPendapatan: shift.transaksis.reduce((sum, item) => sum + item.total, 0),
      ...totals,
      durationHours: shiftDurationHours(shift, now),
      overtime: isShiftOvertime(shift, now),
    })
  })

  if (legacyTransactions.length > 0) {
    const totals = emptyTotals()
    let legacyPendapatan = 0
    for (const transaction of legacyTransactions as ShiftTransaction[]) {
      addTotals(totals, transaction)
      legacyPendapatan += transaction.total
      allItems.push(...transaction.items)
      transaksi.push({
        nomorMeja: transaction.nomorMeja,
        total: transaction.total,
        metodePembayaran: transaction.metodePembayaran || 'CASH',
        createdAt: transaction.createdAt.toISOString(),
        shiftId: null,
        shiftNomor: null,
      })
    }
    grand.totalCash += totals.totalCash
    grand.totalQRIS += totals.totalQRIS
    grand.totalTransfer += totals.totalTransfer
    grand.jumlahItem += totals.jumlahItem
    grandTotalPendapatan += legacyPendapatan
    shifts.push({
      id: 'legacy',
      nomor: shifts.length + 1,
      label: 'Tanpa shift (data lama)',
      status: 'DITUTUP',
      dibukaPada: null,
      ditutupPada: null,
      dibukaOleh: '-',
      ditutupOleh: null,
      catatanBuka: null,
      catatanTutup: null,
      totalTransaksi: legacyTransactions.length,
      totalPendapatan: legacyPendapatan,
      ...totals,
      durationHours: 0,
      overtime: false,
    })
  }

  const uniqueMenuIds = [...new Set(allItems.map((item) => item.menuId))]
  const menuCategories = uniqueMenuIds.length > 0
    ? await db.menu.findMany({
        where: { id: { in: uniqueMenuIds }, warungId },
        select: { id: true, category: { select: { nama: true } } },
      })
    : []
  const kategoriMap = new Map(menuCategories.map((menu) => [menu.id, normalizeKategoriNama(menu.category?.nama)]))

  const rekapMap = new Map<string, LaporanRekapItem>()
  for (const item of allItems) {
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

  const rekap = Array.from(rekapMap.values()).sort((a, b) => {
    const categoryOrder = compareIndonesian(a.kategori, b.kategori)
    return categoryOrder || compareIndonesian(a.namaMenu, b.namaMenu)
  })

  transaksi.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    tanggal: dateKey,
    warung: warung ?? { id: warungId, nama: '-', kode: '-', alamat: null },
    shifts,
    rekap,
    transaksi,
    grandTotalQty: grand.jumlahItem,
    grandTotalPendapatan,
    jumlahTransaksi: transaksi.length,
    totalCash: grand.totalCash,
    totalQRIS: grand.totalQRIS,
    totalTransfer: grand.totalTransfer,
    aktivitasKasir: aktivitasKasir.map((activity) => ({
      waktu: activity.createdAt.toISOString(),
      kasir: activity.user.namaLengkap || activity.user.username,
      aktivitas: activity.aktivitas,
      detail: activity.detail,
    })),
  }
}
