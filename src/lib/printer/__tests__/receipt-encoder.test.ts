import { describe, expect, it } from 'vitest'
import { encodeReceipt } from '../receipt-encoder'

describe('encodeReceipt', () => {
  it('cuts immediately after the final receipt line', () => {
    const output = encodeReceipt({
      transaction: {
        id: 'tx-1',
        nomorMeja: '1',
        total: 10000,
        createdAt: '2026-01-01T10:00:00.000Z',
        items: [{ namaMenu: 'Nasi', hargaSatuan: 10000, qty: 1, subtotal: 10000 }],
      },
      cashier: 'Kasir',
      warungNama: 'Vian Jaya 08',
      width: '80mm',
    })

    expect(Array.from(output.slice(-6))).toEqual([0x1B, 0x33, 20, 0x1D, 0x56, 0x00])
  })

  it('starts with init, keeps item lines within paper width, and emits ASCII text', () => {
    const output = encodeReceipt({
      transaction: {
        id: 'tx-2', nomorMeja: '1', total: 10000, createdAt: '2026-01-01T10:00:00.000Z',
        items: [{ namaMenu: 'Nasi Goreng Sangat Panjang \u2728', hargaSatuan: 10000, qty: 1, subtotal: 10000 }],
      }, cashier: 'Kasir', warungNama: 'Vian Jaya 08', width: '58mm',
    })
    expect(Array.from(output.slice(0, 2))).toEqual([0x1B, 0x40])
    expect(Array.from(output.slice(-6))).toEqual([0x1B, 0x33, 20, 0x1D, 0x56, 0x00])
    expect(new TextDecoder().decode(output)).not.toContain('\u2728')
  })
})
