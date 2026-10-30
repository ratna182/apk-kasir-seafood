import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeReceipt } from '../receipt-encoder'
import { buildReceiptLines, createReceiptData } from '../receipt-content'
import { encodeRasterImage } from '../escpos'

const logo = vi.hoisted(() => ({ load: vi.fn(async (): Promise<Uint8Array | null> => null) }))
vi.mock('../logo', () => ({
  loadReceiptLogo: logo.load,
  clearReceiptLogoCache: () => {},
}))

const CUT_TAIL = [0x1B, 0x33, 20, 0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00]

const TRANSACTION = {
  id: 'tx-1',
  nomorMeja: '1',
  total: 35000,
  createdAt: '2026-01-01T10:00:00.000Z',
  items: [
    { namaMenu: 'Nasi Goreng Seafood', hargaSatuan: 25000, qty: 1, subtotal: 25000 },
    { namaMenu: 'Es Teh Manis', hargaSatuan: 5000, qty: 2, subtotal: 10000 },
  ],
}

function receiptLines(stream: Uint8Array): string[] {
  const lines: string[] = []
  let current: number[] = []
  for (let index = 0; index < stream.length; index++) {
    const value = stream[index]
    if (value === 0x1b || value === 0x1d) {
      index = skipCommand(stream, index)
      continue
    }
    if (value === 0x0a) {
      lines.push(new TextDecoder().decode(new Uint8Array(current)))
      current = []
      continue
    }
    current.push(value)
  }
  if (current.length > 0) lines.push(new TextDecoder().decode(new Uint8Array(current)))
  return lines
}

/** Returns the index of the command's last byte; the caller resumes at the next one. */
function skipCommand(stream: Uint8Array, index: number): number {
  const next = stream[index + 1]
  if (next === undefined) return index
  if (next === 0x76) {
    const bytesPerRow = stream[index + 4] | (stream[index + 5] << 8)
    const rows = stream[index + 6] | (stream[index + 7] << 8)
    return index + 7 + bytesPerRow * rows
  }
  if (next === 0x40) return index + 1
  return index + 2
}

function widestLine(stream: Uint8Array): number {
  return Math.max(...receiptLines(stream).map((line) => line.length))
}

describe('encodeReceipt', () => {
  beforeEach(() => {
    logo.load.mockResolvedValue(null)
  })

  it('cuts immediately after the final receipt line', async () => {
    const output = await encodeReceipt({
      transaction: { ...TRANSACTION, items: [TRANSACTION.items[0]] },
      cashier: 'Kasir',
      warungNama: 'Vian Jaya 08',
      width: '80mm',
    })

    expect(Array.from(output.slice(-10))).toEqual(CUT_TAIL)
  })

  it('starts with init, keeps item lines within paper width, and emits ASCII text', async () => {
    const output = await encodeReceipt({
      transaction: {
        ...TRANSACTION,
        items: [{ namaMenu: 'Nasi Goreng Sangat Panjang \u2728', hargaSatuan: 10000, qty: 1, subtotal: 10000 }],
      },
      cashier: 'Kasir',
      warungNama: 'Vian Jaya 08',
      width: '58mm',
    })
    expect(Array.from(output.slice(0, 2))).toEqual([0x1B, 0x40])
    expect(Array.from(output.slice(-10))).toEqual(CUT_TAIL)
    expect(new TextDecoder().decode(output)).not.toContain('\u2728')
    expect(widestLine(output)).toBeLessThanOrEqual(32)
  })

  it('lays out 58 mm receipts in 32 columns', async () => {
    const output = await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '58mm' })
    expect(widestLine(output)).toBeLessThanOrEqual(32)
  })

  it('lays out 80 mm receipts in 48 columns', async () => {
    const output = await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '80mm' })
    expect(widestLine(output)).toBeLessThanOrEqual(48)
  })

  it('never lets a line exceed the paper, even with long menus and big amounts', async () => {
    const output = await encodeReceipt({
      transaction: {
        ...TRANSACTION,
        total: 12500000,
        items: [
          {
            namaMenu: 'Paket Hemat Seafood Udang Vadon Mentai Sambal Matah',
            hargaSatuan: 12500000,
            qty: 3,
            subtotal: 37500000,
          },
        ],
      },
      cashier: 'Kasir Pagi Shift Satu',
      warungAlamat: 'Jl. Raya教学质量 Nomor 88',
      warungNama: null,
      width: '80mm',
    })
    expect(widestLine(output)).toBeLessThanOrEqual(48)
  })

  it('centres the double-size shop name inside the real double-width footprint', async () => {
    const output = await encodeReceipt({
      transaction: TRANSACTION,
      cashier: 'Kasir',
      warungNama: null,
      width: '80mm',
    })
    const header = receiptLines(output).find((line) => line.includes('Seafood Vian Jaya 08'))
    expect(header).toBeDefined()
    const pad = header?.match(/^ */)?.[0].length ?? 0
    // 20 characters at double width occupy 40 of 48 columns, so the pad is (24 - 20) / 2.
    expect(header?.trimStart().length).toBe(20)
    expect(pad).toBe(2)
    expect(pad * 2 + 20 * 2).toBeLessThanOrEqual(48)
  })

  it('prints exactly the lines shared with the receipt preview', async () => {
    const input = {
      transaction: { ...TRANSACTION, metodePembayaran: 'CASH' },
      cashier: 'Murtoni',
      warungNama: null,
      warungAlamat: 'Jl. Raya Kranggan no.18',
      width: '80mm' as const,
      uangDiterima: 50000,
    }

    const output = await encodeReceipt(input)
    const expected = buildReceiptLines(createReceiptData(input), 48).map((line) => line.text)
    const decoded = receiptLines(output)

    expect(decoded.slice(0, expected.length)).toEqual(expected)
    expect(decoded.slice(expected.length).every((line) => line === '')).toBe(true)
  })

  it('follows the reference block order: logo, name, address, socials, date with cashier', async () => {
    const lines = receiptLines(
      await encodeReceipt({
        transaction: TRANSACTION,
        cashier: 'Murtoni',
        warungNama: null,
        warungAlamat: 'Jl. Raya Kranggan no.18',
        width: '80mm',
      }),
    )
    const order = [
      'Seafood Vian Jaya 08',
      'Jl. Raya Kranggan no.18',
      'IG : Seafood08vianjaya.id',
      'FB : Seafood08vianjaya',
      'TT : Seafood08vianjaya',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = lines.findIndex((line, index) => index > cursor && line.includes(marker))
      expect(at, `bagian "${marker}" tidak ditemukan`).toBeGreaterThan(-1)
      cursor = at
    }

    const dateLine = lines.find((line) => line.includes('Kasir : Murtoni'))
    expect(dateLine).toBeDefined()
    expect(dateLine?.trimStart().startsWith('2026-01-01')).toBe(true)
    expect(dateLine?.endsWith('Kasir : Murtoni')).toBe(true)
    expect(lines[lines.indexOf(dateLine!) + 1]).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('prints the menu name on its own line with qty, unit price and subtotal right aligned', async () => {
    const lines = receiptLines(
      await encodeReceipt({
        transaction: TRANSACTION,
        cashier: 'Kasir',
        warungNama: null,
        width: '80mm',
      }),
    )
    const nameIndex = lines.findIndex((line) => line.trim() === 'Es Teh Manis')
    expect(nameIndex).toBeGreaterThan(-1)
    const detail = lines[nameIndex + 1]
    expect(detail.startsWith('2 X Rp 5.000')).toBe(true)
    expect(detail.endsWith('Rp 10.000')).toBe(true)
    expect(detail.length).toBe(48)
  })

  it('ends with Sub Total, Total, Bayar and the reference footer', async () => {
    const lines = receiptLines(
      await encodeReceipt({
        transaction: { ...TRANSACTION, metodePembayaran: 'TRANSFER' },
        cashier: 'Kasir',
        warungNama: null,
        width: '80mm',
      }),
    )

    expect(lines.some((line) => line === 'Total QTY : 3')).toBe(true)
    expect(lines.some((line) => line.startsWith('Sub Total') && line.endsWith('Rp 35.000'))).toBe(true)
    expect(lines.some((line) => line.startsWith('Total ') && line.endsWith('Rp 35.000'))).toBe(true)
    expect(lines.some((line) => line.startsWith('Bayar (Transfer)') && line.endsWith('Rp 35.000'))).toBe(true)
    expect(lines.filter((line) => line.trim() === 'Terima Kasih')).toHaveLength(1)
    expect(lines.some((line) => line.trim() === 'Selamat Datang Kembali')).toBe(true)
    expect(lines.some((line) => line.trim() === 'Kritik dan Saran WA: 0852-8000-4508')).toBe(true)
    expect(lines.some((line) => line.includes('Kritik & Saran'))).toBe(false)
  })

  it('feeds the paper before cutting so the footer cannot stay behind the cutter', async () => {
    const output = await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '80mm' })
    const feedBeforeCut = Array.from(output.slice(-7))

    expect(feedBeforeCut.slice(0, 4)).toEqual([0x0A, 0x0A, 0x0A, 0x0A])
    expect(feedBeforeCut.slice(4)).toEqual([0x1D, 0x56, 0x00])
  })

  it('never asks the printer to align text, only the logo raster', async () => {
    const withLogo = await encodeReceipt({
      transaction: TRANSACTION,
      cashier: 'Kasir',
      warungNama: 'Warung',
      width: '80mm',
    })
    logo.load.mockResolvedValue(encodeRasterImage({ data: new Uint8Array(8), widthDots: 8, heightDots: 1 }))
    const withRaster = await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '80mm' })

    // ESC a would centre an already padded line a second time and push it right of the paper.
    expect(countAlignCommands(withLogo)).toBe(0)
    expect(countAlignCommands(withRaster)).toBe(2)
  })

  function countAlignCommands(stream: Uint8Array): number {
    let count = 0
    for (let index = 0; index < stream.length - 1; index++) {
      if (stream[index] === 0x1b && stream[index + 1] === 0x61) count++
    }
    return count
  }

  it('labels the payment method per channel and adds the change line for cash', async () => {
    const lines = receiptLines(
      await encodeReceipt({
        transaction: { ...TRANSACTION, metodePembayaran: 'CASH' },
        cashier: 'Kasir',
        warungNama: null,
        width: '80mm',
        uangDiterima: 50000,
        kembalian: 15000,
      }),
    )

    expect(lines.some((line) => line.startsWith('Bayar (Cash)') && line.endsWith('Rp 50.000'))).toBe(true)
    expect(lines.some((line) => line.startsWith('Kembali') && line.endsWith('Rp 15.000'))).toBe(true)
    const qris = receiptLines(
      await encodeReceipt({
        transaction: { ...TRANSACTION, metodePembayaran: 'QRIS' },
        cashier: 'Kasir',
        warungNama: null,
        width: '80mm',
      }),
    )
    expect(qris.some((line) => line.startsWith('Bayar (QRIS)'))).toBe(true)
  })

  it('never guesses a payment method that is missing or unknown', async () => {
    for (const metode of [null, undefined, 'DEBIT']) {
      const lines = receiptLines(
        await encodeReceipt({
          transaction: { ...TRANSACTION, metodePembayaran: metode as never },
          cashier: 'Kasir',
          warungNama: null,
          width: '80mm',
        }),
      )
      expect(lines.some((line) => line.startsWith('Bayar (-)'))).toBe(true)
      expect(lines.some((line) => line.startsWith('Bayar (Cash)'))).toBe(false)
      expect(lines.some((line) => line.startsWith('Kembali'))).toBe(false)
    }
  })

  it('requests the logo raster for the active column count', async () => {
    await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '58mm' })
    expect(logo.load).toHaveBeenCalledWith(32)
  })

  it('prints the raster logo above the shop name when it is available', async () => {
    const raster = encodeRasterImage({ data: new Uint8Array([1, 0, 1, 0]), widthDots: 8, heightDots: 2 })
    logo.load.mockResolvedValue(raster)

    const output = await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '80mm' })
    const rasterAt = indexOfBytes(output, raster)
    const headerAt = indexOfText(output, 'Seafood Vian Jaya 08')

    expect(rasterAt).toBeGreaterThan(-1)
    expect(headerAt).toBeGreaterThan(rasterAt)
    expect(Array.from(output.slice(-10))).toEqual(CUT_TAIL)
    expect(widestLine(output)).toBeLessThanOrEqual(48)
  })

  it('prints without a logo when the raster is unavailable', async () => {
    logo.load.mockResolvedValue(null)
    const output = await encodeReceipt({ transaction: TRANSACTION, cashier: 'Kasir', warungNama: null, width: '80mm' })
    expect(output.length).toBeGreaterThan(100)
    expect(Array.from(output.slice(-10))).toEqual(CUT_TAIL)
  })
})

function indexOfBytes(stream: Uint8Array, needle: Uint8Array): number {
  for (let start = 0; start + needle.length <= stream.length; start++) {
    let match = true
    for (let offset = 0; offset < needle.length; offset++) {
      if (stream[start + offset] !== needle[offset]) {
        match = false
        break
      }
    }
    if (match) return start
  }
  return -1
}

function indexOfText(stream: Uint8Array, text: string): number {
  return indexOfBytes(stream, new TextEncoder().encode(text))
}
