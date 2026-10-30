'use client'

import {
  buildReceiptLines,
  createReceiptData,
  type ReceiptTransaction,
} from '@/lib/printer/receipt-content'
import { CHAR_WIDTHS } from '@/lib/printer/types'

export type PrinterWidth = '58mm' | '80mm'
export type { ReceiptTransaction }

interface ReceiptProps {
  transaction: ReceiptTransaction
  cashier: string
  warungNama: string | null
  warungAlamat?: string | null
  username?: string
  warungKode?: string | null
  width: PrinterWidth
  preview?: boolean
  reprint?: boolean
  uangDiterima?: number
  kembalian?: number
}

export default function Receipt({
  transaction,
  cashier,
  warungNama,
  warungAlamat,
  width,
  preview,
  reprint,
  uangDiterima,
  kembalian,
}: ReceiptProps) {
  const receipt = createReceiptData({
    transaction,
    cashier,
    warungNama,
    warungAlamat,
    reprint,
    uangDiterima,
    kembalian,
  })
  const lines = buildReceiptLines(receipt, CHAR_WIDTHS[width])

  return (
    <div className={`${preview ? 'receipt-preview' : 'print-only print-receipt'} receipt-${width}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="receipt-logo" src="/logo-baru.webp" alt="Seafood 08 Vian Jaya" />
      <div className="receipt-text">
        {lines.map((line, index) => (
          <div key={index} className={line.scale === 2 ? 'receipt-line receipt-line-large' : 'receipt-line'}>
            {line.text || '\u00A0'}
          </div>
        ))}
      </div>
    </div>
  )
}
