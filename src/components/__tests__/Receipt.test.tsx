import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import Receipt from '../Receipt'
import {
  buildReceiptLines,
  createReceiptData,
  type ReceiptTransaction,
} from '@/lib/printer/receipt-content'

const TRANSACTION: ReceiptTransaction = {
  id: 'tx-1',
  nomorMeja: '1',
  total: 35000,
  createdAt: '2026-01-01T10:00:00.000Z',
  metodePembayaran: 'CASH',
  items: [
    { namaMenu: 'Nasi Goreng Seafood', hargaSatuan: 25000, qty: 1, subtotal: 25000 },
    { namaMenu: 'Es Teh Manis', hargaSatuan: 5000, qty: 2, subtotal: 10000 },
  ],
}

const PROPS = {
  transaction: TRANSACTION,
  cashier: 'Murtoni',
  warungNama: 'Vian Jaya 08',
  warungAlamat: 'Jl. Raya Kranggan no.18',
  width: '80mm' as const,
  uangDiterima: 50000,
  kembalian: 15000,
}

describe('Receipt preview', () => {
  it('renders exactly the lines the printer receives', () => {
    const { container } = render(<Receipt {...PROPS} preview />)
    const expected = buildReceiptLines(
      createReceiptData({
        transaction: TRANSACTION,
        cashier: PROPS.cashier,
        warungNama: PROPS.warungNama,
        warungAlamat: PROPS.warungAlamat,
        uangDiterima: PROPS.uangDiterima,
        kembalian: PROPS.kembalian,
      }),
      48,
    )

    const rendered = Array.from(container.querySelectorAll('.receipt-line')).map(
      (line) => line.textContent,
    )

    expect(rendered).toEqual(expected.map((line) => line.text))
  })

  it('shows the cash received and the change instead of the total twice', () => {
    const { container } = render(<Receipt {...PROPS} preview />)
    const text = container.querySelector('.receipt-text')?.textContent ?? ''

    expect(text).toContain('Bayar (Cash)')
    expect(text).toContain('Rp 50.000')
    expect(text).toContain('Kembali')
    expect(text).toContain('Rp 15.000')
    expect(text).not.toContain('Pembayaran')
    expect(text).not.toContain('Tunai')
    expect(text).not.toContain('Terimakasih')
  })

  it('marks the double-size shop name for the preview stylesheet', () => {
    const { container } = render(<Receipt {...PROPS} preview />)
    const large = container.querySelectorAll('.receipt-line-large')

    expect(large).toHaveLength(1)
    expect(large[0].textContent).toContain('Seafood Vian Jaya 08')
  })
})
