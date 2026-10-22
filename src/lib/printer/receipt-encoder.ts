import { CHAR_WIDTHS } from './types'
import { loadReceiptLogo } from './logo'
import { createWriter, rightText } from './layout'
import { formatBranchLine } from '@/lib/branch-config'
import {
  initPrinter,
  feedAndCut,
  setAlign,
  setLineSpacing,
  compose,
  drawLine,
  formatRupiah,
  setCharset,
  setCodePage,
  setPrintDensity,
  setFontSize,
  CUT_FEED_LINES,
} from './escpos'

export interface ReceiptTransaction {
  id: string
  nomorMeja: string
  total: number
  createdAt: string
  metodePembayaran?: string | null
  items: Array<{
    namaMenu: string
    hargaSatuan: number
    diskonSatuan?: number
    catatan?: string | null
    qty: number
    subtotal: number
  }>
}


export async function encodeReceipt(
  data: {
    transaction: ReceiptTransaction
    cashier: string
    warungNama: string | null
    warungAlamat?: string | null
    username?: string
    warungKode?: string | null
    width: '58mm' | '80mm'
    reprint?: boolean
    uangDiterima?: number
    kembalian?: number
  },
): Promise<Uint8Array> {
  const w = CHAR_WIDTHS[data.width]
  const t = data.transaction
  const { emit, center } = createWriter(w)
  const parts: Uint8Array[] = []

  parts.push(initPrinter())
  parts.push(setCharset(0))
  parts.push(setCodePage(0))
  parts.push(setPrintDensity(7))
  parts.push(setLineSpacing(20))
  parts.push(setFontSize(1, 1))

  const logo = await loadReceiptLogo(w)
  if (logo) {
    parts.push(setAlign('center'))
    parts.push(logo)
    parts.push(setAlign('left'))
  }

  if (data.reprint) {
    parts.push(center('*** CETAK ULANG STRUK RESMI ***'))
  }

  parts.push(center('Seafood Vian Jaya 08', { scale: 2 }))
  parts.push(center(formatBranchLine(data.warungNama)))
  if (data.warungAlamat) parts.push(center(data.warungAlamat))
  parts.push(center('IG : Seafood08vianjaya.id'))
  parts.push(center('FB : Seafood08vianjaya'))
  parts.push(center('TT : Seafood08vianjaya'))

  parts.push(emit(drawLine(w)))

  const createdAt = new Date(t.createdAt)
  const dateText = createdAt.toLocaleDateString('sv-SE')
  const timeText = `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}:${pad2(createdAt.getSeconds())}`
  parts.push(emit(dateText + `Kasir : ${data.cashier}`.padStart(Math.max(1, w - dateText.length))))
  parts.push(emit(timeText))

  parts.push(emit(drawLine(w)))

  for (const item of t.items) {
    parts.push(emit(item.namaMenu))
    const detail = `${item.qty} X ${formatRupiah(item.hargaSatuan)}${
      item.diskonSatuan ? ` - diskon ${formatRupiah(item.diskonSatuan)}` : ''
    }`
    parts.push(emit(detail + rightText(formatRupiah(item.subtotal), Math.max(1, w - detail.length))))
    if (item.catatan) parts.push(emit(item.catatan))
  }

  parts.push(emit(drawLine(w)))

  const totalQty = t.items.reduce((acc, item) => acc + item.qty, 0)
  parts.push(emit(`Total QTY : ${totalQty}`))
  parts.push(emit(labeledAmount('Sub Total', t.total, w)))
  parts.push(emit(labeledAmount('Total', t.total, w)))
  parts.push(emit(labeledAmount(`Bayar (${paymentLabel(t.metodePembayaran)})`, t.total, w)))
  if (t.metodePembayaran === 'CASH' && data.kembalian !== undefined) {
    parts.push(emit(labeledAmount('Kembali', data.kembalian, w)))
  }

  parts.push(emit(drawLine(w)))

  parts.push(center('Terima Kasih'))
  parts.push(center('Selamat Datang Kembali'))
  parts.push(center('Kritik dan Saran WA: 0852-8000-4508'))

  parts.push(setLineSpacing(20))
  parts.push(feedAndCut(CUT_FEED_LINES))

  return compose(...parts)
}

function paymentLabel(method: string | null | undefined): string {
  if (method === 'QRIS') return 'Qris'
  if (method === 'TRANSFER') return 'Transfer'
  if (method === 'CASH') return 'Cash'
  return '-'
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function labeledAmount(label: string, amount: number, width: number): string {
  const value = formatRupiah(amount)
  if (label.length + value.length > width) return label + '\n' + rightText(value, width)
  return label + value.padStart(width - label.length)
}
