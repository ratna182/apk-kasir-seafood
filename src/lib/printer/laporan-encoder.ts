import { CHAR_WIDTHS } from './types'
import { loadReceiptLogo } from './logo'
import { centerText, createWriter, placeColumns, rightText } from './layout'
import { DEFAULT_BRANCH_NAME, formatBranchLine } from '@/lib/branch-config'
import { formatWibShiftRange, formatWibTime } from '@/lib/time'
import {
  initPrinter,
  feedAndCut,
  setAlign,
  setLineSpacing,
  setFontSize,
  compose,
  padRight,
  drawLine,
  CUT_FEED_LINES,
} from './escpos'

export interface LaporanRekapItem {
  namaMenu: string
  kategori: string
  qtyTotal: number
  pendapatanTotal: number
}

export interface LaporanTransaksi {
  nomorMeja: string
  total: number
  metodePembayaran: string
  createdAt: string
}

export interface LaporanAktivitasKasir {
  waktu: string
  kasir: string
  aktivitas: string
  detail: string | null
}

export interface LaporanShift {
  id: string
  nomor: number
  label: string
  status: 'TERBUKA' | 'DITUTUP'
  dibukaPada: string | null
  ditutupPada: string | null
  dibukaOleh: string
  ditutupOleh: string | null
  totalTransaksi: number
  totalPendapatan: number
  overtime: boolean
}

export interface LaporanData {
  tanggal: string
  warung: { id: string; nama: string; kode: string; alamat?: string | null }
  shifts: LaporanShift[]
  rekap: LaporanRekapItem[]
  transaksi: LaporanTransaksi[]
  grandTotalQty: number
  grandTotalPendapatan: number
  jumlahTransaksi: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
  aktivitasKasir: LaporanAktivitasKasir[]
}

function clock(iso: string | null | undefined): string {
  return formatWibTime(iso)
}

function metodeLabel(method: string): string {
  if (method === 'QRIS') return 'QRIS'
  if (method === 'TRANSFER') return 'TRSF'
  return 'CASH'
}

function rupiah(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

export async function encodeLaporan(
  data: LaporanData,
  cashierName: string,
  warungAlamat: string | null,
  width: '58mm' | '80mm',
): Promise<Uint8Array> {
  const w = CHAR_WIDTHS[width]
  const { emit, center } = createWriter(w)
  const parts: Uint8Array[] = []

  parts.push(initPrinter())
  parts.push(setLineSpacing(20))
  parts.push(setFontSize(1, 1))

  const logo = await loadReceiptLogo(w)
  if (logo) {
    parts.push(setAlign('center'))
    parts.push(logo)
    parts.push(setAlign('left'))
  }

  if (warungAlamat && !data.warung.nama) parts.push(center(warungAlamat))
  parts.push(center('IG : Seafood08vianjaya.id'))
  parts.push(center('FB : Seafood08vianjaya'))
  parts.push(center('TT : Seafood08vianjaya'))

  parts.push(emit(drawLine(w)))
  parts.push(center('LAPORAN PENJUALAN HARIAN'))
  parts.push(emit(drawLine(w)))

  parts.push(center(`Tanggal: ${data.tanggal}`))
  parts.push(center(formatBranchLine(data.warung.nama)))
  for (const shift of data.shifts) {
    parts.push(center(`${shift.label}${shift.status === 'TERBUKA' ? ' (MASIH BUKA)' : ''}`))
    parts.push(center(formatWibShiftRange(shift.dibukaPada, shift.ditutupPada)))
    parts.push(center(`${shift.dibukaOleh}${shift.ditutupOleh ? ` / ${shift.ditutupOleh}` : ''}`))
    if (shift.overtime) parts.push(center('OVERTIME > 18 JAM'))
  }

  parts.push(emit(drawLine(w)))
  parts.push(center('DAFTAR TRANSAKSI'))
  parts.push(emit(drawLine(w)))

  const mejaStart = 0
  const waktuStart = Math.round(w * 0.27)
  const metodeStart = Math.round(w * 0.55)
  parts.push(
    emit(
      placeColumns(
        [
          { text: 'MEJA', start: mejaStart },
          { text: 'WAKTU', start: waktuStart },
          { text: 'METODE', start: metodeStart },
          { text: 'TOTAL', end: w },
        ],
        w,
      ).line,
    ),
  )
  parts.push(emit(drawLine(w)))

  for (const tx of data.transaksi) {
    parts.push(
      emit(
        placeColumns(
          [
            { text: tx.nomorMeja, start: mejaStart },
            { text: clock(tx.createdAt), start: waktuStart },
            { text: metodeLabel(tx.metodePembayaran), start: metodeStart },
            { text: tx.total.toLocaleString('id-ID'), end: w },
          ],
          w,
        ).line,
      ),
    )
  }

  parts.push(emit(drawLine(w)))
  parts.push(center('DETAIL SHIFT'))
  parts.push(emit(drawLine(w)))

  const labelWidth = Math.max(1, Math.floor(w * 0.72))
  const kasirRow = (label: string, waktu: string | null | undefined) =>
    emit(padRight(centerText(label, labelWidth), labelWidth) + clock(waktu).padStart(w - labelWidth))
  for (const shift of data.shifts) {
    parts.push(kasirRow(`${shift.label} buka`, shift.dibukaPada))
    parts.push(kasirRow(`${shift.label} tutup`, shift.ditutupPada))
  }

  parts.push(emit(drawLine(w)))
  parts.push(center('REKAP MENU'))
  parts.push(emit(drawLine(w)))

  const qtyEnd = w - Math.max(9, Math.floor(w * 0.22))
  parts.push(
    emit(
      placeColumns(
        [
          { text: 'MENU', start: 1 },
          { text: 'QTY', end: qtyEnd },
          { text: 'TOTAL', end: w },
        ],
        w,
      ).line,
    ),
  )
  parts.push(emit(drawLine(w)))

  // One column of indent, one gap, and the QTY header needs three columns of its own.
  const nameWidth = Math.max(1, qtyEnd - 4)
  for (const item of data.rekap) {
    const qty = String(item.qtyTotal)
    const total = item.pendapatanTotal.toLocaleString('id-ID')
    if (item.namaMenu.length <= nameWidth) {
      parts.push(
        emit(
          placeColumns(
            [
              { text: item.namaMenu, start: 1 },
              { text: qty, end: qtyEnd },
              { text: total, end: w },
            ],
            w,
          ).line,
        ),
      )
    } else {
      // The name has no room left, so qty and total move to their own line rather than colliding.
      parts.push(emit(item.namaMenu))
      parts.push(emit(rightText(`${qty} ${total}`, w)))
    }
  }

  parts.push(emit(drawLine(w)))
  parts.push(center('TOTAL PER METODE BAYAR'))
  parts.push(emit(drawLine(w)))
  parts.push(emit(padRight('CASH', w - rupiah(data.totalCash).length) + rupiah(data.totalCash)))
  parts.push(emit(padRight('QRIS', w - rupiah(data.totalQRIS).length) + rupiah(data.totalQRIS)))
  parts.push(emit(padRight('TRANSFER', w - rupiah(data.totalTransfer).length) + rupiah(data.totalTransfer)))

  parts.push(emit(drawLine(w)))
  parts.push(emit('Total Qty:' + `${data.grandTotalQty} item`.padStart(w - 'Total Qty:'.length)))
  parts.push(emit('Total Transaksi:' + `${data.jumlahTransaksi} transaksi`.padStart(w - 'Total Transaksi:'.length)))

  parts.push(
    emit(
      centerText('GRAND TOTAL:', Math.floor(w / 2)) + rupiah(data.grandTotalPendapatan).padStart(w - Math.floor(w / 2)),
      { scale: 2 },
    ),
  )

  parts.push(emit(drawLine(w)))
  parts.push(center('*** REKAPITULASI RESMI ***'))
  parts.push(center(cashierName || DEFAULT_BRANCH_NAME))

  parts.push(setLineSpacing(20))
  parts.push(feedAndCut(CUT_FEED_LINES))

  return compose(...parts)
}
