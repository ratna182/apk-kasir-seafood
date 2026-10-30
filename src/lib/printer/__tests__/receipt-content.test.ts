import { describe, expect, it } from 'vitest'
import {
  buildReceiptLines,
  createReceiptData,
  paymentLabel,
  type CreateReceiptInput,
  type ReceiptTransaction,
} from '../receipt-content'

const TRANSACTION: ReceiptTransaction = {
  id: 'tx-1',
  nomorMeja: '1',
  total: 35000,
  createdAt: '2026-01-01T10:00:00.000Z',
  items: [
    { namaMenu: 'Nasi Goreng Seafood', hargaSatuan: 25000, qty: 1, subtotal: 25000 },
    { namaMenu: 'Es Teh Manis', hargaSatuan: 5000, qty: 2, subtotal: 10000 },
  ],
}

function makeReceipt(
  transaction: Partial<ReceiptTransaction> = {},
  input: Partial<CreateReceiptInput> = {},
) {
  return createReceiptData({
    transaction: { ...TRANSACTION, ...transaction },
    cashier: 'Murtoni',
    warungNama: 'Vian Jaya 08',
    ...input,
  })
}

function textsOf(receipt: ReturnType<typeof makeReceipt>, width = 48): string[] {
  return buildReceiptLines(receipt, width).map((line) => line.text)
}

describe('createReceiptData', () => {
  it('derives the change and keeps the cash amount for cash payments', () => {
    const receipt = makeReceipt({ metodePembayaran: 'CASH' }, { uangDiterima: 50000 })
    expect(receipt.uangDiterima).toBe(50000)
    expect(receipt.kembalian).toBe(15000)
  })

  it('never shows cash fields for non-cash payments', () => {
    const receipt = makeReceipt(
      { metodePembayaran: 'QRIS' },
      { uangDiterima: 50000, kembalian: 15000 },
    )
    expect(receipt.uangDiterima).toBeUndefined()
    expect(receipt.kembalian).toBeUndefined()
  })

  it('does not invent a change line when the cashier never entered cash', () => {
    const receipt = makeReceipt({ metodePembayaran: 'CASH' })
    expect(receipt.kembalian).toBeUndefined()
  })
})

describe('buildReceiptLines', () => {
  it('prints the cash received on the Bayar (Cash) line instead of the total', () => {
    const texts = textsOf(makeReceipt({ metodePembayaran: 'CASH' }, { uangDiterima: 50000 }))

    expect(texts.some((line) => line.startsWith('Bayar (Cash)') && line.endsWith('Rp 50.000'))).toBe(true)
    expect(texts.some((line) => line.startsWith('Kembali') && line.endsWith('Rp 15.000'))).toBe(true)
    expect(texts.some((line) => line.startsWith('Total') && line.endsWith('Rp 35.000'))).toBe(true)
  })

  it('aligns every summary amount on the same column', () => {
    const texts = textsOf(makeReceipt({ metodePembayaran: 'CASH' }, { uangDiterima: 50000 }))
    const rows = texts.filter(
      (line) => line.includes('Rp') && /^(Sub Total|Total |Bayar|Kembali)/.test(line),
    )

    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((line) => line.indexOf('Rp'))).size).toBe(1)
  })

  it('bills the total and omits Kembali for non-cash channels', () => {
    for (const [method, label] of [
      ['QRIS', 'QRIS'],
      ['TRANSFER', 'Transfer'],
      [null, '-'],
      ['DEBIT', '-'],
    ] as const) {
      const texts = textsOf(makeReceipt({ metodePembayaran: method }))
      expect(texts.some((line) => line.startsWith(`Bayar (${label})`) && line.endsWith('Rp 35.000'))).toBe(true)
      expect(texts.some((line) => line.startsWith('Kembali'))).toBe(false)
    }
  })

  it('keeps every 58 mm line inside 32 columns, including the wrapped double-size name', () => {
    const lines = buildReceiptLines(makeReceipt({ metodePembayaran: 'CASH' }, { uangDiterima: 50000 }), 32)

    expect(Math.max(...lines.map((line) => line.text.length))).toBeLessThanOrEqual(32)
    expect(lines.filter((line) => line.scale === 2)).toHaveLength(2)
  })

  it('keeps the subtotal intact when an item detail is longer than the paper', () => {
    const receipt = makeReceipt(
      {
        metodePembayaran: 'CASH',
        total: 37500000,
        items: [
          {
            namaMenu: 'Paket Hemat Seafood Udang Vadon Mentai Sambal Matah',
            hargaSatuan: 12500000,
            diskonSatuan: 1000000,
            catatan: 'Tanpa sambal, saus terpisah',
            qty: 3,
            subtotal: 37500000,
          },
        ],
      },
      { uangDiterima: 50000000 },
    )
    const lines = buildReceiptLines(receipt, 32)

    expect(Math.max(...lines.map((line) => line.text.length))).toBeLessThanOrEqual(32)
    expect(lines.some((line) => line.text.endsWith('Rp 37.500.000'))).toBe(true)
    expect(lines.some((line) => line.text.includes('Tanpa sambal, saus terpisah'))).toBe(true)
  })

  it('uses the same footer text as the printer reference', () => {
    const texts = textsOf(makeReceipt({ metodePembayaran: 'TRANSFER' }))
    expect(texts.some((line) => line.trim() === 'Terima Kasih')).toBe(true)
    expect(texts.some((line) => line.trim() === 'Selamat Datang Kembali')).toBe(true)
    expect(texts.some((line) => line.trim() === 'Kritik dan Saran WA: 0852-8000-4508')).toBe(true)
    expect(texts.some((line) => line.includes('Terimakasih'))).toBe(false)
  })

  it('marks reprints above the shop name', () => {
    const texts = textsOf(makeReceipt({}, { reprint: true }))
    expect(texts.findIndex((line) => line.includes('CETAK ULANG'))).toBeLessThan(
      texts.findIndex((line) => line.includes('Seafood Vian Jaya 08')),
    )
  })

  it('formats the date and time in WIB', () => {
    const texts = textsOf(makeReceipt())
    expect(texts.some((line) => line.trimStart().startsWith('2026-01-01'))).toBe(true)
    expect(texts).toContain('17:00:00')
  })
})

describe('paymentLabel', () => {
  it('never guesses an unknown payment method', () => {
    expect(paymentLabel('CASH')).toBe('Cash')
    expect(paymentLabel('QRIS')).toBe('QRIS')
    expect(paymentLabel('TRANSFER')).toBe('Transfer')
    expect(paymentLabel(null)).toBe('-')
    expect(paymentLabel('DEBIT')).toBe('-')
  })
})
