import { formatBranchLine } from '@/lib/branch-config'
import { formatWibDateTime } from '@/lib/time'

export interface NotaPreviewItem {
  namaMenu: string
  qty: number
  hargaSatuan: number
  diskonSatuan?: number
  catatan?: string | null
  subtotal: number
}

export interface NotaPreviewProps {
  branchName: string | null
  nomorMeja: string
  createdAt: string
  items: NotaPreviewItem[]
  total: number
  label: string
}

const rupiah = (amount: number) => `Rp ${amount.toLocaleString('id-ID')}`

export default function NotaPreview({
  branchName,
  nomorMeja,
  createdAt,
  items,
  total,
  label,
}: NotaPreviewProps) {
  return (
    <div className="nota-preview">
      <div className="nota-preview-head">
        <p className="nota-preview-branch">{formatBranchLine(branchName)}</p>
        <p>{formatWibDateTime(createdAt)} WIB</p>
        <p>Meja: <strong>{nomorMeja}</strong></p>
      </div>

      <div className="nota-preview-label">{label}</div>

      <div className="nota-preview-items">
        {items.map((item, index) => {
          const diskon = item.diskonSatuan ?? 0
          return (
            <div className="nota-preview-item" key={`${item.namaMenu}-${index}`}>
              <div className="nota-preview-item-name">{item.namaMenu}</div>
              <div className="nota-preview-item-subtotal">{rupiah(item.subtotal)}</div>
              <div className="nota-preview-item-price">
                {item.qty} x {rupiah(item.hargaSatuan)}
                {diskon > 0 && <span> - diskon {rupiah(diskon)}</span>}
              </div>
              {item.catatan && <div className="nota-preview-item-note">{item.catatan}</div>}
            </div>
          )
        })}
      </div>

      <div className="nota-preview-total">
        <span>TOTAL</span>
        <strong>{rupiah(total)}</strong>
      </div>
    </div>
  )
}
