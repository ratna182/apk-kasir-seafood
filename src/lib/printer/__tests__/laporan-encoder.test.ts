import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeLaporan, type LaporanData } from '../laporan-encoder'

const logo = vi.hoisted(() => ({ load: vi.fn(async (): Promise<Uint8Array | null> => null) }))
vi.mock('../logo', () => ({
  loadReceiptLogo: logo.load,
  clearReceiptLogoCache: () => {},
}))

const CUT_TAIL = [0x1B, 0x33, 20, 0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00]

const DATA: LaporanData = {
  tanggal: '2026-09-16',
  warung: { id: 'w1', nama: 'Seafood & Nasi Uduk Vian Jaya 08 - Cabang 2', kode: '08', alamat: 'Jl. Pesisir No. 1' },
  rekap: [
    { namaMenu: 'Ikan Baronang Goreng Kering', kategori: 'Ikan', qtyTotal: 1, pendapatanTotal: 65000 },
    { namaMenu: 'Ikan Gurame Bakar', kategori: 'Ikan', qtyTotal: 1, pendapatanTotal: 60000 },
  ],
  transaksi: [{ nomorMeja: 'Meja 3', total: 260000, metodePembayaran: 'TRANSFER', createdAt: '2026-09-16T10:13:00.000Z' }],
  grandTotalQty: 4,
  grandTotalPendapatan: 260000,
  jumlahTransaksi: 1,
  totalCash: 0,
  totalQRIS: 0,
  totalTransfer: 260000,
  aktivitasKasir: [
    { waktu: '2026-09-16T10:14:00.000Z', kasir: 'Kasir', aktivitas: 'BUKA_KASIR', detail: null },
    { waktu: '2026-09-16T22:14:00.000Z', kasir: 'Kasir', aktivitas: 'TUTUP_KASIR', detail: null },
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

function indexOfBytes(stream: Uint8Array, needle: Uint8Array): number {
  for (let start = 0; start + needle.length <= stream.length; start++) {
    if (needle.every((byte, offset) => stream[start + offset] === byte)) return start
  }
  return -1
}

describe('encodeLaporan', () => {
  beforeEach(() => {
    logo.load.mockResolvedValue(null)
  })

  it('follows the section order of the reference receipt', async () => {
    const lines = receiptLines(
      await encodeLaporan(DATA, 'Kasir Vian Jaya 08', null, '80mm', { ditutupPada: '2026-09-16T22:14:00.000Z', ditutupOleh: 'Kasir' }),
    )

    const order = [
      'IG : Seafood08vianjaya.id',
      'LAPORAN PENJUALAN HARIAN',
      'Tanggal: 2026-09-16',
      'Cabang: Seafood & Nasi Uduk Vian Jaya 08 -',
      'Status: SUDAH DITUTUP',
      'DAFTAR TRANSAKSI',
      'DETAIL KASIR',
      'REKAP MENU',
      'TOTAL PER METODE BAYAR',
      '*** REKAPITULASI RESMI ***',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = lines.findIndex((line, index) => index > cursor && line.includes(marker))
      expect(at, `section "${marker}" tidak ditemukan`).toBeGreaterThan(-1)
      cursor = at
    }
  })

  it('keeps every line inside 48 columns on 80 mm paper', async () => {
    const output = await encodeLaporan(DATA, 'Kasir Vian Jaya 08', null, '80mm', {
      ditutupPada: '2026-09-16T22:14:00.000Z',
      ditutupOleh: 'Kasir',
    })
    expect(widestLine(output)).toBeLessThanOrEqual(48)
  })

  it('keeps every line inside 32 columns on 58 mm paper', async () => {
    const output = await encodeLaporan(DATA, 'Kasir Vian Jaya 08', null, '58mm', {
      ditutupPada: '2026-09-16T22:14:00.000Z',
      ditutupOleh: 'Kasir',
    })
    expect(widestLine(output)).toBeLessThanOrEqual(32)
  })

  it('lines up the transaction table in MEJA, WAKTU, METODE and TOTAL columns', async () => {
    const lines = receiptLines(await encodeLaporan(DATA, 'Kasir', null, '80mm'))
    const header = lines.find((line) => line.includes('MEJA') && line.includes('WAKTU') && line.includes('TOTAL'))
    const row = lines.find((line) => line.includes('Meja 3'))

    expect(header).toBeDefined()
    expect(row).toBeDefined()
    expect(header?.indexOf('MEJA')).toBe(0)
    expect(row?.indexOf('Meja 3')).toBe(0)
    expect(row?.indexOf('TRSF')).toBe(header?.indexOf('METODE'))
    // WAKTU and TOTAL are right-aligned, so their right edges must match, not their starts.
    expect(row?.length).toBe(48)
    expect(header?.endsWith('TOTAL')).toBe(true)
    expect(row?.endsWith('260.000')).toBe(true)
  })

  it('aligns the menu recap into MENU, QTY and TOTAL columns', async () => {
    const lines = receiptLines(await encodeLaporan(DATA, 'Kasir', null, '80mm'))
    const header = lines.find((line) => line.includes('MENU') && line.includes('QTY') && line.includes('TOTAL'))
    const row = lines.find((line) => line.includes('Ikan Baronang'))

    expect(header).toBeDefined()
    expect(row).toBeDefined()
    expect(row?.indexOf('1')).toBe((header?.indexOf('QTY') ?? 0) + 2)
    expect(row?.endsWith('65.000')).toBe(true)
    expect(header?.endsWith('TOTAL')).toBe(true)
  })

  it('puts the grand total in double size with the label and value aligned', async () => {
    const output = await encodeLaporan(DATA, 'Kasir', null, '80mm')
    const lines = receiptLines(output)

    expect(lines.some((line) => line.includes('GRAND TOTAL:'))).toBe(true)
    expect(lines.some((line) => line.includes('Rp 260.000') && line.includes('GRAND TOTAL:'))).toBe(true)
    expect(lines.some((line) => line.trimStart().startsWith('Total Qty:') && line.endsWith('4 item'))).toBe(true)
    expect(lines.some((line) => line.trimStart().startsWith('Total Transaksi:') && line.endsWith('1 transaksi'))).toBe(true)
    expect(Array.from(output.slice(-10))).toEqual(CUT_TAIL)
  })

  it('shows Buka and Tutup Kasir times on the right side', async () => {
    const lines = receiptLines(
      await encodeLaporan(DATA, 'Kasir', null, '80mm', {
        ditutupPada: '2026-09-16T22:14:00.000Z',
        ditutupOleh: 'Kasir',
      }),
    )
    const buka = lines.find((line) => line.includes('Buka Kasir'))
    const tutup = lines.find((line) => line.includes('Tutup Kasir'))

    expect(buka).toBeDefined()
    expect(tutup).toBeDefined()
    expect(buka?.length).toBe(48)
    expect(tutup?.length).toBe(48)
  })

  it('prints the logo raster above the social handles when available', async () => {
    const raster = new Uint8Array([0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0xff, 0x00])
    logo.load.mockResolvedValue(raster)

    const output = await encodeLaporan(DATA, 'Kasir', null, '80mm')
    expect(indexOfBytes(output, raster)).toBeGreaterThan(-1)
    expect(indexOfBytes(output, raster)).toBeLessThan(indexOfBytes(output, new TextEncoder().encode('IG :')))
  })

  it('moves qty and total to their own line when a menu name does not fit', async () => {
    const longMenu = {
      ...DATA,
      rekap: [{ namaMenu: 'Ikan Baronang Goreng Kering Sambal Matah', kategori: 'Ikan', qtyTotal: 3, pendapatanTotal: 195000 }],
    }
    for (const width of ['58mm', '80mm'] as const) {
      const lines = receiptLines(await encodeLaporan(longMenu, 'Kasir', null, width))
      const nameIndex = lines.findIndex((line) => line.includes('Ikan Baronang'))
      const qtyLine = lines.slice(nameIndex).find((line) => line.trim().startsWith('3'))

      expect(qtyLine, `baris qty tidak ditemukan pada ${width}`).toBeDefined()
      expect(qtyLine?.trim()).toBe('3 195.000')
      expect(widestLine(await encodeLaporan(longMenu, 'Kasir', null, width))).toBeLessThanOrEqual(width === '80mm' ? 48 : 32)
    }
  })

  it('wraps a branch name that is wider than the paper instead of clipping it', async () => {
    const output = await encodeLaporan(DATA, 'Kasir', null, '80mm')
    const squashed = receiptLines(output).join('').replace(/\s+/g, '')

    expect(squashed).toContain('Cabang:Seafood&NasiUdukVianJaya08-Cabang2')
    expect(widestLine(output)).toBeLessThanOrEqual(48)
  })

  it('omits the session block when the shift is still open', async () => {
    const lines = receiptLines(await encodeLaporan(DATA, 'Kasir', null, '80mm', null))
    expect(lines.some((line) => line.includes('Status:'))).toBe(false)
    expect(lines.some((line) => line.includes('DAFTAR TRANSAKSI'))).toBe(true)
  })
})
