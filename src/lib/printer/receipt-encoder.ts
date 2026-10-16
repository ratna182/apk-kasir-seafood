import { CHAR_WIDTHS } from './types'
import { loadReceiptLogo } from './logo'
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
  formatRupiah,
  setCharset,
  setCodePage,
  setPrintDensity,
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

type Align = 'left' | 'center' | 'right'
type Scale = 1 | 2

/** Double-width text occupies two columns per character, so it only fits at half the width. */
function fitScale(text: string, width: number, requested: Scale): Scale {
  if (requested === 1) return 1
  return text.length * 2 <= width ? 2 : 1
}

function centerText(text: string, width: number, scale: Scale = 1): string {
  const columns = Math.max(1, Math.floor(width / scale))
  if (text.length >= columns) return text.slice(0, columns)
  return ' '.repeat(Math.floor((columns - text.length) / 2)) + text
}

function rightText(text: string, width: number, scale: Scale = 1): string {
  const columns = Math.max(1, Math.floor(width / scale))
  if (text.length >= columns) return text.slice(0, columns)
  return ' '.repeat(columns - text.length) + text
}

function wrapText(text: string, width: number): string[] {
  const columns = Math.max(1, width)
  if (text.length <= columns) return [text]
  const lines: string[] = []
  let rest = text
  while (rest.length > columns) {
    lines.push(rest.slice(0, columns))
    rest = rest.slice(columns)
  }
  if (rest.length > 0) lines.push(rest)
  return lines
}

function createWriter(width: number) {
  const emit = (
    text: string,
    options: { bold?: boolean; align?: Align; scale?: Scale } = {},
  ): Uint8Array => {
    const bold = options.bold ?? true
    const align = options.align ?? 'left'
    const requested = options.scale ?? 1
    // Double width that overflows the paper drops to double height so the line stays emphatic.
    const fontWidth = fitScale(text, width, requested)
    const fontHeight = requested === 2 ? 2 : 1
    const parts: Uint8Array[] = []
    for (const chunk of wrapText(text, Math.max(1, Math.floor(width / fontWidth)))) {
      parts.push(setBold(bold))
      if (align !== 'left') parts.push(setAlign(align))
      if (fontHeight > 1) parts.push(setFontSize(fontWidth, fontHeight))
      parts.push(setText(chunk + '\n'))
      if (fontHeight > 1) parts.push(setFontSize(1, 1))
      if (align !== 'left') parts.push(setAlign('left'))
    }
    return compose(...parts)
  }

  const center = (text: string, options: { bold?: boolean; scale?: Scale } = {}): Uint8Array => {
    const scale = fitScale(text, width, options.scale ?? 1)
    return emit(centerText(text, width, scale), { ...options, align: 'center', scale })
  }

  const right = (text: string, options: { bold?: boolean; scale?: Scale } = {}): Uint8Array => {
    const scale = fitScale(text, width, options.scale ?? 1)
    return emit(rightText(text, width, scale), { ...options, align: 'right', scale })
  }

  return { emit, center, right }
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
