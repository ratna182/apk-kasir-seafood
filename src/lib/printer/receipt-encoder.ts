import { CHAR_WIDTHS } from './types'
import { loadReceiptLogo } from './logo'
import { createWriter } from './layout'
import {
  initPrinter,
  feedAndCut,
  setAlign,
  setLineSpacing,
  compose,
  padRight,
  drawLine,
  formatRupiah,
  setCharset,
  setCodePage,
  setPrintDensity,
  setFontSize,
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
  const { emit, center, right } = createWriter(w)
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

  parts.push(center('Seafood 08 Vian Jaya', { scale: 2 }))
  if (data.warungAlamat) parts.push(center(data.warungAlamat))
  parts.push(center('IG : Seafood08vianjaya.id'))
  parts.push(center('FB : Seafood08vianjaya'))
  parts.push(center('TT : Seafood08vianjaya'))

  parts.push(emit(drawLine(w)))

  const date = new Date(t.createdAt)
  parts.push(emit(`${date.toLocaleDateString('sv-SE')}  ${date.toLocaleTimeString('id-ID')}`))
  parts.push(right(`Kasir : ${data.cashier}`))

  parts.push(emit(drawLine(w)))

  for (const item of t.items) {
    const price = formatRupiah(item.subtotal)
    if (item.namaMenu.length + price.length <= w) {
      parts.push(emit(padRight(item.namaMenu, w - price.length) + price))
    } else {
      parts.push(emit(item.namaMenu))
      parts.push(right(price))
    }
    parts.push(
      emit(
        `${item.qty} X ${formatRupiah(item.hargaSatuan)}${
          item.diskonSatuan ? ` - diskon ${formatRupiah(item.diskonSatuan)}` : ''
        }`,
      ),
    )
    if (item.catatan) parts.push(emit(item.catatan))
  }

  parts.push(emit(drawLine(w)))

  const totalQty = t.items.reduce((acc, item) => acc + item.qty, 0)
  parts.push(emit(`Total QTY : ${totalQty}`))
  parts.push(emit(`Subtotal   ${formatRupiah(t.total)}`))

  parts.push(emit(drawLine(w)))

  parts.push(emit(`Total      ${formatRupiah(t.total)}`, { scale: 2 }))

  const isCash = t.metodePembayaran === 'CASH'
  if (isCash && data.uangDiterima !== undefined) {
    parts.push(emit(`Tunai      ${formatRupiah(data.uangDiterima)}`))
    parts.push(emit(`Kembali    ${formatRupiah(data.kembalian ?? 0)}`))
  }

  parts.push(emit(drawLine(w)))

  parts.push(center('Terimakasih'))
  parts.push(center('Selamat Datang Kembali'))
  parts.push(center('Kritik & Saran'))
  parts.push(center('WA 0852-8000-4508'))

  parts.push(setLineSpacing(20))
  parts.push(feedAndCut(0))

  return compose(...parts)
}
