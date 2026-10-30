import { formatBranchLine } from '@/lib/branch-config'
import { centerText, fitScale, rightText, wrapText, type Scale } from './layout'

export type ReceiptWidth = '58mm' | '80mm'

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

export interface ReceiptData {
  transaction: ReceiptTransaction
  cashier: string
  warungNama: string | null
  warungAlamat: string | null
  reprint: boolean
  uangDiterima?: number
  kembalian?: number
}

export interface CreateReceiptInput {
  transaction: ReceiptTransaction
  cashier: string
  warungNama: string | null
  warungAlamat?: string | null
  reprint?: boolean
  uangDiterima?: number
  kembalian?: number
}

export interface ReceiptLine {
  /** Already padded to the paper columns, so preview and printer show the same text. */
  text: string
  scale?: Scale
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

export function createReceiptData(input: CreateReceiptInput): ReceiptData {
  const isCash = input.transaction.metodePembayaran === 'CASH'
  const uangDiterima = isCash ? input.uangDiterima : undefined
  let kembalian = isCash ? input.kembalian : undefined

  if (isCash && uangDiterima !== undefined && kembalian === undefined) {
    kembalian = Math.max(0, uangDiterima - input.transaction.total)
  }

  return {
    transaction: input.transaction,
    cashier: input.cashier,
    warungNama: input.warungNama,
    warungAlamat: input.warungAlamat ?? null,
    reprint: input.reprint ?? false,
    uangDiterima,
    kembalian,
  }
}

export function paymentLabel(method: string | null | undefined): string {
  if (method === 'CASH') return 'Cash'
  if (method === 'QRIS') return 'QRIS'
  if (method === 'TRANSFER') return 'Transfer'
  return '-'
}

export function buildReceiptLines(receipt: ReceiptData, width: number): ReceiptLine[] {
  const lines: ReceiptLine[] = []
  const t = receipt.transaction
  const isCash = t.metodePembayaran === 'CASH'
  const amountWidth = amountColumnWidth(receipt)

  const left = (text: string) => {
    for (const chunk of wrapText(text, width)) lines.push({ text: chunk })
  }

  const centered = (text: string, scale: Scale = 1) => {
    const columns = Math.max(1, Math.floor(width / scale))
    for (const chunk of wrapText(text, columns)) {
      const lineScale = fitScale(chunk, width, scale)
      lines.push({ text: centerText(chunk, width, lineScale), scale: lineScale })
    }
  }

  const separator = () => lines.push({ text: '-'.repeat(width) })

  const row = (label: string, right: string) => {
    for (const text of twoColumn(label, right, width)) lines.push({ text })
  }

  if (receipt.reprint) centered('*** CETAK ULANG STRUK RESMI ***')

  centered('Seafood Vian Jaya 08', 2)
  centered(formatBranchLine(receipt.warungNama))
  if (receipt.warungAlamat) centered(receipt.warungAlamat)
  centered('IG : Seafood08vianjaya.id')
  centered('FB : Seafood08vianjaya')
  centered('TT : Seafood08vianjaya')

  separator()

  const { dateText, timeText } = wibParts(t.createdAt)
  const cashierText = `Kasir : ${receipt.cashier}`
  if (dateText.length + cashierText.length + 1 <= width) {
    row(dateText, cashierText)
  } else {
    left(dateText)
    lines.push({ text: rightText(cashierText, width) })
  }
  left(timeText)

  separator()

  for (const item of t.items) {
    left(item.namaMenu)
    const detail = `${item.qty} X ${formatAmount(item.hargaSatuan)}${
      item.diskonSatuan ? ` - diskon ${formatAmount(item.diskonSatuan)}` : ''
    }`
    row(detail, amountText(item.subtotal, amountWidth))
    if (item.catatan) left(item.catatan)
  }

  separator()

  const totalQty = t.items.reduce((sum, item) => sum + item.qty, 0)
  left(`Total QTY : ${totalQty}`)
  row('Sub Total', amountText(t.total, amountWidth))
  row('Total', amountText(t.total, amountWidth))

  const paid = isCash ? receipt.uangDiterima ?? t.total : t.total
  row(`Bayar (${paymentLabel(t.metodePembayaran)})`, amountText(paid, amountWidth))
  if (isCash && receipt.kembalian !== undefined) {
    row('Kembali', amountText(receipt.kembalian, amountWidth))
  }

  separator()

  centered('Terima Kasih')
  centered('Selamat Datang Kembali')
  centered('Kritik dan Saran WA: 0852-8000-4508')

  return lines
}

function amountColumnWidth(receipt: ReceiptData): number {
  const t = receipt.transaction
  const isCash = t.metodePembayaran === 'CASH'
  const values = [t.total]

  if (isCash && receipt.uangDiterima !== undefined) values.push(receipt.uangDiterima)
  if (isCash && receipt.kembalian !== undefined) values.push(receipt.kembalian)
  for (const item of t.items) {
    values.push(item.hargaSatuan, item.subtotal)
    if (item.diskonSatuan) values.push(item.diskonSatuan)
  }

  return Math.max(1, ...values.map((value) => amountDigits(value).length))
}

function formatAmount(amount: number): string {
  const value = Number.isFinite(amount) ? Math.trunc(amount) : 0
  return `Rp ${value.toLocaleString('id-ID')}`
}

function amountDigits(amount: number): string {
  return formatAmount(amount).slice(3)
}

function amountText(amount: number, width: number): string {
  return `Rp ${amountDigits(amount).padStart(width)}`
}

function twoColumn(left: string, right: string, width: number): string[] {
  if (!left) return [rightText(right, width)]
  if (!right) return wrapText(left, width)

  const available = width - right.length - 1
  if (available < 1) return [...wrapText(left, width), rightText(right, width)]

  if (left.length <= available) {
    return [left + ' '.repeat(width - left.length - right.length) + right]
  }

  const leftLines = wrapText(left, available)
  const lastIndex = leftLines.length - 1
  const last = leftLines[lastIndex]
  leftLines[lastIndex] = last + ' '.repeat(width - last.length - right.length) + right
  return leftLines
}

function wibParts(createdAt: string): { dateText: string; timeText: string } {
  const date = new Date(new Date(createdAt).getTime() + WIB_OFFSET_MS)
  if (Number.isNaN(date.getTime())) return { dateText: '-', timeText: '--:--:--' }

  return {
    dateText: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    timeText: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`,
  }
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}
