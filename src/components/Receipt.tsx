'use client'

import { formatBranchLine } from '@/lib/branch-config'

export type PrinterWidth = '58mm' | '80mm'

export interface ReceiptTransaction {
  id: string
  nomorMeja: string
  total: number
  createdAt: string
  metodePembayaran?: string | null
  items: Array<{ namaMenu: string; hargaSatuan: number; diskonSatuan?: number; catatan?: string | null; qty: number; subtotal: number }>
}

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

const rupiah = (amount: number) => `Rp ${amount.toLocaleString('id-ID')}`

export default function Receipt({ transaction, cashier, warungNama, warungAlamat, width, preview, reprint, uangDiterima, kembalian }: ReceiptProps) {
  const date = new Date(transaction.createdAt)
  const totalQty = transaction.items.reduce((total, item) => total + item.qty, 0)
  const payment = transaction.metodePembayaran === 'QRIS' ? 'QRIS' : transaction.metodePembayaran === 'TRANSFER' ? 'Transfer' : 'Cash'
  const itemCount = transaction.items.length
  const isCompact = itemCount > 8
  const isCash = transaction.metodePembayaran === 'CASH'

  return (
    <div className={`${preview ? 'receipt-preview' : 'print-only print-receipt'} receipt-${width} ${isCompact ? 'compact' : ''}`}>
      <div className="print-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="receipt-logo" src="/logo-baru.webp" alt="Seafood 08 Vian Jaya" />
        <p className="receipt-branch">{formatBranchLine(warungNama)}</p>
        {warungAlamat && <p>{warungAlamat}</p>}
        <div className="receipt-socials">
          <p>IG : Seafood08vianjaya.id</p>
          <p>FB : Seafood08vianjaya</p>
          <p>TT : Seafood08vianjaya</p>
        </div>
      </div>
      <div className="print-divider" />
      <div className="receipt-meta">
        <div>{date.toLocaleDateString('sv-SE')} {date.toLocaleTimeString('id-ID')} | Kasir : {cashier}</div>
      </div>
      <div className="print-divider" />
      <div className="receipt-items">
        {transaction.items.map((item, index) => (
          <div key={index} className="receipt-item-block">
            {isCompact ? (
              <div className="receipt-item-row">
                <span>{item.namaMenu} {item.qty}x</span>
                <span>{rupiah(item.subtotal)}</span>
              </div>
            ) : (
              <>
                <div className="receipt-item-row">
                  <span>{item.namaMenu}</span>
                  <span>{rupiah(item.subtotal)}</span>
                </div>
                <div className="receipt-item-detail">{item.qty} x {rupiah(item.hargaSatuan)}{item.diskonSatuan ? ` -${rupiah(item.diskonSatuan)}` : ''}</div>
                {item.catatan && <div className="receipt-item-note">{item.catatan}</div>}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="print-divider" />
      <div className="receipt-summary">
        <div className="receipt-row"><span>Total QTY</span><span>{totalQty}</span></div>
        <div className="receipt-row"><span>Subtotal</span><span>{rupiah(transaction.total)}</span></div>
        <div className="receipt-row receipt-grand"><span>Total</span><span>{rupiah(transaction.total)}</span></div>
        <div className="receipt-row"><span>Pembayaran</span><span>{payment}</span></div>
        {isCash && uangDiterima !== undefined && (
          <>
            <div className="receipt-row"><span>Tunai</span><span>{rupiah(uangDiterima)}</span></div>
            <div className="receipt-row"><span>Kembali</span><span>{rupiah(kembalian ?? 0)}</span></div>
          </>
        )}
      </div>
      <div className="print-divider" />
      <div className="print-footer">
        {reprint && <p>*** CETAK ULANG STRUK RESMI ***</p>}
        <p>Terimakasih</p>
        <p>Selamat Datang Kembali</p>
        <p>Kritik &amp; Saran</p>
        <p className="receipt-contact"><b className="receipt-social-icon">WA</b> 0852-8000-4508</p>
      </div>
    </div>
  )
}
