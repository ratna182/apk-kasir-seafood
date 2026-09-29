import { CHAR_WIDTHS } from './types'
import {
  initPrinter,
  feedAndCut,
  setText,
  setAlign,
  setBold,
  setFontSize,
  setLineSpacing,
  compose,
  padRight,
  drawLine,
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

export interface LaporanData {
  tanggal: string
  warung: { id: string; nama: string; kode: string; alamat?: string | null }
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

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width)
  const pad = Math.floor((width - text.length) / 2)
  return ' '.repeat(pad) + text
}

function encodeLine(text: string, bold: boolean = true, align: 'left' | 'center' | 'right' = 'left', fontSize: 1 | 2 = 1): Uint8Array {
  const parts: Uint8Array[] = []
  parts.push(setBold(bold))
  if (align !== 'left') parts.push(setAlign(align))
  if (fontSize > 1) parts.push(setFontSize(fontSize, fontSize))
  parts.push(setText(text + '\n'))
  if (fontSize > 1) parts.push(setFontSize(1, 1))
  if (align !== 'left') parts.push(setAlign('left'))
  return compose(...parts)
}

export function encodeLaporan(
  data: LaporanData,
  cashierName: string,
  warungAlamat: string | null,
  width: '58mm' | '80mm',
  kasirSesi?: { ditutupPada: string; ditutupOleh: string } | null,
): Uint8Array {
  const w = CHAR_WIDTHS[width]
  const parts: Uint8Array[] = []

  parts.push(initPrinter())
  parts.push(setLineSpacing(20))
  parts.push(setFontSize(1, 1))

  // Header sama seperti struk customer
  parts.push(encodeLine(centerText('Seafood 08 Vian Jaya', w), true, 'center', 2))
  if (warungAlamat) {
    parts.push(encodeLine(centerText(warungAlamat, w), true, 'center'))
  }
  parts.push(encodeLine(centerText('IG : Seafood08vianjaya.id', w), true, 'center'))
  parts.push(encodeLine(centerText('FB : Seafood08vianjaya', w), true, 'center'))
  parts.push(encodeLine(centerText('TT : Seafood08vianjaya', w), true, 'center'))

  parts.push(encodeLine(drawLine(w), true))

  parts.push(encodeLine(centerText('LAPORAN PENJUALAN HARIAN', w), true, 'center', 2))

  parts.push(encodeLine(drawLine(w), true))

  parts.push(encodeLine(`Tanggal : ${data.tanggal}`, true))
  parts.push(encodeLine(`Dicetak : ${new Date().toLocaleTimeString('id-ID')}`, true))
  parts.push(encodeLine(`Kasir   : ${cashierName}`, true))

  if (kasirSesi) {
    parts.push(encodeLine('Status  : SUDAH DITUTUP', true))
    parts.push(encodeLine(`Pkl     : ${new Date(kasirSesi.ditutupPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`, true))
  }

  parts.push(encodeLine(drawLine(w), true))
  parts.push(encodeLine(centerText('AKTIVITAS KASIR', w), true, 'center'))
  parts.push(encodeLine(drawLine(w), true))
  if (data.aktivitasKasir.length === 0) {
    parts.push(encodeLine('Tidak ada aktivitas', true))
  } else {
    for (const aktivitas of data.aktivitasKasir) {
      const jenis = aktivitas.aktivitas === 'LOGIN'
        ? 'LOGIN KASIR'
        : aktivitas.aktivitas === 'BUKA_KASIR'
          ? 'BUKA KASIR'
          : 'TUTUP KASIR'
      parts.push(encodeLine(`${new Date(aktivitas.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} ${jenis}`, true))
      parts.push(encodeLine(`Kasir: ${aktivitas.kasir}`, true))
      if (aktivitas.detail) parts.push(encodeLine(aktivitas.detail, true))
    }
  }

  parts.push(encodeLine(drawLine(w), true))

  // Daftar transaksi dengan metode bayar
  parts.push(encodeLine(centerText('DAFTAR TRANSAKSI', w), true, 'center'))
  parts.push(encodeLine(drawLine(w), true))

  for (const tx of data.transaksi) {
    const metode = tx.metodePembayaran === 'QRIS' ? 'QRIS' : tx.metodePembayaran === 'TRANSFER' ? 'TRSF' : 'CASH'
    const time = new Date(tx.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    const totalStr = `Rp ${tx.total.toLocaleString('id-ID')}`
    const label = `${tx.nomorMeja} ${time} [${metode}]`
    const leftWidth = w - totalStr.length - 1
    parts.push(encodeLine(padRight(label, Math.max(1, leftWidth)) + totalStr, true))
  }

  parts.push(encodeLine(drawLine(w), true))

  // Rekap per menu
  parts.push(encodeLine(centerText('REKAP MENU', w), true, 'center'))
  parts.push(encodeLine(drawLine(w), true))

  for (const item of data.rekap) {
    const qtyStr = String(item.qtyTotal)
    const totalStr = `Rp ${item.pendapatanTotal.toLocaleString('id-ID')}`
    const leftWidth = w - qtyStr.length - totalStr.length - 2
    const nameLine = padRight(item.namaMenu, Math.max(1, leftWidth)) + qtyStr + ' ' + totalStr
    parts.push(encodeLine(nameLine, true))
  }

  parts.push(encodeLine(drawLine(w), true))

  // Total per metode bayar
  parts.push(encodeLine(centerText('TOTAL PER METODE BAYAR', w), true, 'center'))
  const cashStr = `Rp ${data.totalCash.toLocaleString('id-ID')}`
  const qrisStr = `Rp ${data.totalQRIS.toLocaleString('id-ID')}`
  const trsfStr = `Rp ${data.totalTransfer.toLocaleString('id-ID')}`
  parts.push(encodeLine(padRight('CASH', Math.max(1, w - cashStr.length)) + cashStr, true))
  parts.push(encodeLine(padRight('QRIS', Math.max(1, w - qrisStr.length)) + qrisStr, true))
  parts.push(encodeLine(padRight('TRANSFER', Math.max(1, w - trsfStr.length)) + trsfStr, true))

  parts.push(encodeLine(drawLine(w), true))

  const gtyStr = String(data.grandTotalQty)
  const gtpStr = `Rp ${data.grandTotalPendapatan.toLocaleString('id-ID')}`
  const gLeft = w - gtyStr.length - gtpStr.length - 2
  parts.push(encodeLine(padRight('TOTAL QTY', Math.max(1, gLeft)) + gtyStr + ' ' + gtpStr, true))

  const jmlStr = `${data.jumlahTransaksi} transaksi`
  const jLeft = w - jmlStr.length
  parts.push(encodeLine(padRight('TOTAL TRANSAKSI', Math.max(1, jLeft)) + jmlStr, true))

  parts.push(encodeLine(drawLine(w), true))

  const gtLabel = 'GRAND TOTAL'
  const gtVal = `Rp ${data.grandTotalPendapatan.toLocaleString('id-ID')}`
  const gtLeft = w - gtLabel.length - gtVal.length
  parts.push(encodeLine(padRight(gtLabel, Math.max(1, gtLeft)) + gtVal, true, 'left', 2))

  parts.push(encodeLine(drawLine(w), true))

  parts.push(encodeLine(centerText('*** REKAPITULASI RESMI ***', w), true, 'center'))
  parts.push(encodeLine(centerText('Kasir Vian Jaya 08', w), true, 'center'))

  // Cut immediately after the final line; the iMin cutter already handles its minimum feed.
  parts.push(setLineSpacing(20))
  parts.push(feedAndCut(0))

  return compose(...parts)
}
