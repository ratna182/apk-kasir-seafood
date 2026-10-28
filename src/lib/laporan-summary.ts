import { getStoreDateKey } from './time'

export interface LaporanSummaryShift {
  id: string
  dibukaPada: string | null
  totalTransaksi: number
  jumlahItem: number
  totalPendapatan: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
}

export interface LaporanSummarySource {
  jumlahTransaksi: number
  grandTotalQty: number
  grandTotalPendapatan: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
  shifts: LaporanSummaryShift[]
}

export interface LaporanSummary {
  scope: 'SHIFT' | 'HARIAN'
  jumlahTransaksi: number
  grandTotalQty: number
  grandTotalPendapatan: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
}

export function resolveLaporanSummary(
  data: LaporanSummarySource | null,
  openShift: { id: string; dibukaPada: string | null } | null,
  tanggal: string,
): LaporanSummary | null {
  if (!data) return null

  const openedAt = openShift?.dibukaPada ? new Date(openShift.dibukaPada) : null
  const shiftDateKey = openedAt && !Number.isNaN(openedAt.getTime()) ? getStoreDateKey(openedAt) : null
  const activeShift = openShift && shiftDateKey === tanggal
    ? data.shifts.find((shift) => shift.id === openShift.id)
    : undefined

  if (activeShift) {
    return {
      scope: 'SHIFT',
      jumlahTransaksi: activeShift.totalTransaksi,
      grandTotalQty: activeShift.jumlahItem,
      grandTotalPendapatan: activeShift.totalPendapatan,
      totalCash: activeShift.totalCash,
      totalQRIS: activeShift.totalQRIS,
      totalTransfer: activeShift.totalTransfer,
    }
  }

  return {
    scope: 'HARIAN',
    jumlahTransaksi: data.jumlahTransaksi,
    grandTotalQty: data.grandTotalQty,
    grandTotalPendapatan: data.grandTotalPendapatan,
    totalCash: data.totalCash,
    totalQRIS: data.totalQRIS,
    totalTransfer: data.totalTransfer,
  }
}
