'use client'

import { useState, useEffect } from 'react'
import { Search, Clock, Printer } from 'lucide-react'
import PrinterSetup from '@/components/PrinterSetup'
import PrinterStatusBadge from '@/components/PrinterStatus'
import { printer } from '@/lib/printer'
import { loadPrinterConfig } from '@/lib/printer/storage'
import { encodeLaporan, type LaporanData } from '@/lib/printer/laporan-encoder'

interface RekapItem {
  namaMenu: string
  kategori: string
  qtyTotal: number
  pendapatanTotal: number
}

interface TransaksiItem {
  nomorMeja: string
  total: number
  metodePembayaran: string
  createdAt: string
}

interface KasirSesi {
  id: string
  tanggal: string
  ditutupPada: string
  dibukaKembaliPada: string | null
  ditutupOleh: string
  totalTransaksi: number
  totalPendapatan: number
  warungNama: string
  warungKode: string
  warungAlamat: string | null
  detail: {
    rekap: RekapItem[]
    transaksi: TransaksiItem[]
    grandTotalQty: number
    totalCash: number
    totalQRIS: number
    totalTransfer: number
    jumlahTransaksi: number
  }
}

interface RiwayatClientProps {
  session: { warungKode: string | null; role: string }
  initialKasirSesis: KasirSesi[]
  initialStartDate?: string
  initialEndDate?: string
}

export default function RiwayatClient({ session, initialKasirSesis, initialStartDate, initialEndDate }: RiwayatClientProps) {
  const [kasirSesis] = useState<KasirSesi[]>(initialKasirSesis)
  const [search, setSearch] = useState('')
  const [printerWidth, setPrinterWidth] = useState<'58mm' | '80mm'>('80mm')
  const [showPrinterSetup, setShowPrinterSetup] = useState(false)

  useEffect(() => {
    const saved = loadPrinterConfig()
    if (saved) {
      setPrinterWidth(saved.width)
      printer.autoReconnect()
    }
  }, [])

  const filtered = kasirSesis.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.warungKode.toLowerCase().includes(q) || s.ditutupOleh.toLowerCase().includes(q) || s.tanggal.includes(q)
  })

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Riwayat Laporan Harian</h1>
          <p className="text-secondary text-sm">{kasirSesis.length} sesi kasir • {session.role === 'OWNER' ? 'Semua cabang' : `Cabang: ${session.warungKode}`}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <form style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" name="mulai" aria-label="Tanggal mulai" defaultValue={initialStartDate} className="form-input" />
            <span className="text-secondary text-sm">sampai</span>
            <input type="date" name="sampai" aria-label="Tanggal akhir" defaultValue={initialEndDate} className="form-input" />
            <button type="submit" className="btn btn-ghost btn-sm">Filter tanggal</button>
            {(initialStartDate || initialEndDate) && <a href="/riwayat" className="btn btn-ghost btn-sm">Semua waktu</a>}
          </form>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {(['58mm', '80mm'] as const).map((w) => (
              <button key={w} type="button" onClick={() => setPrinterWidth(w)} className={`btn btn-sm ${printerWidth === w ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
                {w}
              </button>
            ))}
          </div>
          <PrinterStatusBadge onSetupClick={() => setShowPrinterSetup(true)} />
          <div style={{ position: 'relative', minWidth: '260px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Cari kasir atau tanggal..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: '36px' }}
            />
          </div>
        </div>
      </div>

      <div className="no-print">
        {kasirSesis.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <h3>Belum Ada Sesi Kasir</h3>
            <p className="text-secondary text-sm">Riwayat laporan kasir (buka/tutup) akan muncul di sini.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
            <p className="text-secondary">Tidak ada sesi kasir yang cocok dengan &quot;{search}&quot;.</p>
            <button onClick={() => setSearch('')} className="btn btn-ghost btn-sm" style={{ marginTop: '0.75rem' }}>Reset Pencarian</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {filtered.map((sesi) => (
              <LaporanCard key={sesi.id} sesi={sesi} printerWidth={printerWidth} />
            ))}
          </div>
        )}
      </div>

      <PrinterSetup open={showPrinterSetup} onClose={() => setShowPrinterSetup(false)} onConfigured={(config) => { if (config) setPrinterWidth(config.width) }} />
    </div>
  )
}

function LaporanCard({ sesi, printerWidth }: { sesi: KasirSesi; printerWidth: '58mm' | '80mm' }) {
  const [expanded, setExpanded] = useState(false)
  const [printing, setPrinting] = useState(false)
  const d = sesi.detail

  // Handle print with auto-retry via forceReconnect
  const handlePrintWithRetry = async (data: Uint8Array, retries = 2): Promise<boolean> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ok = await printer.print(data)
      if (ok) return true
      
      if (attempt < retries) {
        console.log(`Print attempt ${attempt + 1} failed, trying forceReconnect...`)
        await printer.forceReconnect()
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    return false
  }
  const tanggal = new Date(sesi.tanggal + 'T00:00:00')
  const tanggalStr = tanggal.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const bukaStr = sesi.dibukaKembaliPada
    ? new Date(sesi.dibukaKembaliPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : '-'
  const tutupStr = new Date(sesi.ditutupPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

  function buildLaporanData(): LaporanData {
    return {
      tanggal: sesi.tanggal,
      warung: { id: '', nama: sesi.warungNama, kode: sesi.warungKode, alamat: sesi.warungAlamat },
      rekap: d.rekap,
      transaksi: d.transaksi,
      grandTotalQty: d.grandTotalQty,
      grandTotalPendapatan: sesi.totalPendapatan,
      jumlahTransaksi: d.jumlahTransaksi,
      totalCash: d.totalCash,
      totalQRIS: d.totalQRIS,
      totalTransfer: d.totalTransfer,
      aktivitasKasir: [],
    }
  }

  function handlePrint() {
    const printWindow = window.open('', '_blank', 'width=280,height=500')
    if (printWindow) {
      const receiptEl = document.querySelector(`#print-receipt-${sesi.id}`)
      const receiptHTML = receiptEl ? receiptEl.outerHTML : ''
      printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cetak Laporan</title><style>@page{size:auto;margin:0}*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;margin:0;padding:0}body{width:100%;margin:0;padding:0 2mm;font-family:'Helvetica','Arial',sans-serif;font-size:15px;font-weight:bold;color:black;background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-receipt{width:100%;padding:0 2mm;text-align:center}.print-header{text-align:center;margin-bottom:3px}.receipt-logo{display:block;width:1.7cm;height:1.7cm;object-fit:contain;margin:0 auto 3px}.receipt-socials{text-align:center}.receipt-socials p{display:block;margin:0;text-align:center}.print-header h2{font-size:18px;text-transform:uppercase;margin:0 0 2px;line-height:1.3}.print-header p{font-size:14px;margin:0;line-height:1.3}.print-divider{border:none;border-top:1px dashed black;margin:3px 0}.print-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:2px}.print-table{page-break-inside:auto}.print-table thead{display:table-header-group}.print-table tr{page-break-inside:avoid;break-inside:avoid}.print-table th,.print-table td{padding:1px 0;line-height:1.4;overflow-wrap:anywhere}.print-table th{border-bottom:1px dashed black;font-size:13px}.text-right{text-align:right}.print-total{margin-top:3px;border-top:1px dashed black;padding-top:3px}.print-total-row{display:flex;justify-content:space-between;font-size:14px;line-height:1.4}.print-total-row.grand{font-size:17px;font-weight:800;margin-top:1px}.print-footer{text-align:center;margin-top:3px;margin-bottom:0;padding-bottom:0;font-size:14px;line-height:1.4}.print-footer p{margin:0;line-height:1.4}@media print{body{width:100%}.print-receipt{width:100%}}</style></head><body>${receiptHTML}</body></html>`)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => { printWindow.print() }, 300)
    }
  }

  async function handlePrintThermal() {
    setPrinting(true)
    try {
      const data = buildLaporanData()
      const encoded = encodeLaporan(data, sesi.ditutupOleh, sesi.warungAlamat, printerWidth, { ditutupPada: sesi.ditutupPada, ditutupOleh: sesi.ditutupOleh })
      const success = await handlePrintWithRetry(encoded)
      if (success) {
        alert('Laporan berhasil dicetak.')
      } else {
        handlePrint()
      }
    } catch {
      alert('Gagal mencetak laporan.')
    } finally { setPrinting(false) }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header card — collapsed */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none', borderBottom: expanded ? '1px solid var(--color-border)' : 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Clock size={16} style={{ color: 'var(--color-text-muted)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{tanggalStr}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              Buka {bukaStr} → Tutup {tutupStr} • {sesi.ditutupOleh}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{d.jumlahTransaksi} transaksi</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>
            Rp {sesi.totalPendapatan.toLocaleString('id-ID')}
          </div>
        </div>
      </button>

      {/* Expanded — format persis seperti cetak laporan */}
      {expanded && (
        <div style={{ padding: '1.25rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>LAPORAN PENJUALAN HARIAN</div>
          </div>

          <div style={{ borderTop: '1px dashed var(--color-border)', borderBottom: '1px dashed var(--color-border)', padding: '0.5rem 0', marginBottom: '0.75rem', fontSize: '0.85rem', fontWeight: 700 }}>
            <div>Tanggal: {sesi.tanggal}</div>
            <div>Cabang: {sesi.warungNama}</div>
            <div>Status: SUDAH DITUTUP</div>
            <div>Pkl: {tutupStr}</div>
          </div>

          {/* RINGKASAN */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-brand)', fontFamily: "var(--font-fraunces), serif" }}>{d.jumlahTransaksi}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Transaksi</div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif" }}>{d.grandTotalQty}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total Porsi</div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>Rp {sesi.totalPendapatan.toLocaleString('id-ID')}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total Pendapatan</div>
            </div>
          </div>

          {/* PAYMENT METHOD CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ textAlign: 'center', padding: '0.4rem', borderLeft: '3px solid var(--color-success)', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif" }}>Rp {d.totalCash.toLocaleString('id-ID')}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>Cash</div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.4rem', borderLeft: '3px solid var(--color-warning)', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-warning)', fontFamily: "var(--font-fraunces), serif" }}>Rp {d.totalQRIS.toLocaleString('id-ID')}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>QRIS</div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.4rem', borderLeft: '3px solid var(--color-info)', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-info)', fontFamily: "var(--font-fraunces), serif" }}>Rp {d.totalTransfer.toLocaleString('id-ID')}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>Transfer</div>
            </div>
          </div>

          {/* DAFTAR TRANSAKSI */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', marginBottom: '2px' }}>DAFTAR TRANSAKSI</div>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.2rem 0', textAlign: 'left' }}>MEJA</th>
                  <th style={{ padding: '0.2rem 0', textAlign: 'left' }}>WAKTU</th>
                  <th style={{ padding: '0.2rem 0', textAlign: 'left' }}>METODE</th>
                  <th style={{ padding: '0.2rem 0', textAlign: 'right' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {d.transaksi.map((tx, i) => (
                  <tr key={i}>
                    <td style={{ padding: '0.15rem 0' }}>{tx.nomorMeja}</td>
                    <td style={{ padding: '0.15rem 0' }}>{new Date(tx.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ padding: '0.15rem 0' }}>{tx.metodePembayaran === 'QRIS' ? 'QRIS' : tx.metodePembayaran === 'TRANSFER' ? 'TRSF' : 'CASH'}</td>
                    <td style={{ padding: '0.15rem 0', textAlign: 'right' }}>{tx.total.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
          </div>

          {/* DETAIL KASIR */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', marginBottom: '2px' }}>DETAIL KASIR</div>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <tbody>
                <tr><td style={{ padding: '0.15rem 0', fontWeight: 700 }}>Buka Kasir</td><td style={{ padding: '0.15rem 0', textAlign: 'right' }}>{bukaStr}</td></tr>
                <tr><td style={{ padding: '0.15rem 0', fontWeight: 700 }}>Tutup Kasir</td><td style={{ padding: '0.15rem 0', textAlign: 'right' }}>{tutupStr}</td></tr>
              </tbody>
            </table>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
          </div>

          {/* REKAP MENU */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', marginBottom: '2px' }}>REKAP MENU</div>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.2rem 0', textAlign: 'left' }}>MENU</th>
                  <th style={{ padding: '0.2rem 0', textAlign: 'right' }}>QTY</th>
                  <th style={{ padding: '0.2rem 0', textAlign: 'right' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {d.rekap.map((item, i) => (
                  <tr key={i}>
                    <td style={{ padding: '0.15rem 0' }}>{item.namaMenu}</td>
                    <td style={{ padding: '0.15rem 0', textAlign: 'right' }}>{item.qtyTotal}</td>
                    <td style={{ padding: '0.15rem 0', textAlign: 'right' }}>{item.pendapatanTotal.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
          </div>

          {/* TOTAL PER METODE BAYAR */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center', marginBottom: '2px' }}>TOTAL PER METODE BAYAR</div>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.15rem 0' }}><span>CASH</span><span>Rp {d.totalCash.toLocaleString('id-ID')}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.15rem 0' }}><span>QRIS</span><span>Rp {d.totalQRIS.toLocaleString('id-ID')}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.15rem 0' }}><span>TRANSFER</span><span>Rp {d.totalTransfer.toLocaleString('id-ID')}</span></div>
            <div style={{ borderTop: '1px dashed var(--color-border)' }} />
          </div>

          {/* GRAND TOTAL */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.15rem 0' }}><span>Total Qty:</span><span>{d.grandTotalQty} item</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.15rem 0' }}><span>Total Transaksi:</span><span>{d.jumlahTransaksi} transaksi</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 800, padding: '0.3rem 0', borderTop: '1px solid var(--color-border)', marginTop: '0.25rem' }}>
              <span>GRAND TOTAL:</span>
              <span style={{ color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>
                Rp {sesi.totalPendapatan.toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          {/* TOMBOL CETAK */}
          <div className="no-print" style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
            <button type="button" onClick={handlePrintThermal} disabled={printing} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <Printer size={16} /> {printing ? 'Mencetak...' : 'Cetak Laporan'}
            </button>
          </div>

          <div style={{ borderTop: '1px dashed var(--color-border)', marginTop: '0.5rem', paddingTop: '0.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            *** REKAPITULASI RESMI ***<br />Kasir Vian Jaya 08
          </div>
        </div>
      )}

      {/* Print Receipt (hidden, untuk thermal print fallback) */}
      <div className="print-only print-receipt" id={`print-receipt-${sesi.id}`}>
        <div className="print-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="receipt-logo" src="/logo-struk.webp" alt="Seafood 08 Vian Jaya" style={{ display: 'block', width: '1.7cm', height: '1.7cm', objectFit: 'contain', margin: '0 auto 3px' }} />
          {sesi.warungAlamat && <p>{sesi.warungAlamat}</p>}
          <div className="receipt-socials">
            <p>IG : Seafood08vianjaya.id</p>
            <p>FB : Seafood08vianjaya</p>
            <p>TT : Seafood08vianjaya</p>
          </div>
        </div>
        <div className="print-divider" />
        <div style={{ fontSize: '14px', fontWeight: 'bold', textAlign: 'center', marginBottom: '4px' }}>LAPORAN PENJUALAN HARIAN</div>
        <div className="print-divider" />
        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
          <div>Tanggal: {sesi.tanggal}</div>
          <div>Cabang: {sesi.warungNama}</div>
          <div>Status: SUDAH DITUTUP</div>
          <div>Pkl: {tutupStr}</div>
        </div>
        <div className="print-divider" />
        <div style={{ fontSize: '13px', fontWeight: 'bold', textAlign: 'center', marginBottom: '2px' }}>DAFTAR TRANSAKSI</div>
        <div className="print-divider" />
        <table className="print-table">
          <thead><tr><th>MEJA</th><th>WAKTU</th><th>METODE</th><th className="text-right">TOTAL</th></tr></thead>
          <tbody>
            {d.transaksi.map((tx, i) => (
              <tr key={i}>
                <td>{tx.nomorMeja}</td>
                <td>{new Date(tx.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                <td>{tx.metodePembayaran === 'QRIS' ? 'QRIS' : tx.metodePembayaran === 'TRANSFER' ? 'TRSF' : 'CASH'}</td>
                <td className="text-right">{tx.total.toLocaleString('id-ID')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="print-divider" />
        <div style={{ fontSize: '13px', fontWeight: 'bold', textAlign: 'center', marginBottom: '2px' }}>DETAIL KASIR</div>
        <div className="print-divider" />
        <table className="print-table">
          <tbody>
            <tr><td style={{ fontWeight: 'bold' }}>Buka Kasir</td><td className="text-right">{bukaStr}</td></tr>
            <tr><td style={{ fontWeight: 'bold' }}>Tutup Kasir</td><td className="text-right">{tutupStr}</td></tr>
          </tbody>
        </table>
        <div className="print-divider" />
        <div style={{ fontSize: '13px', fontWeight: 'bold', textAlign: 'center', marginBottom: '2px' }}>REKAP MENU</div>
        <div className="print-divider" />
        <table className="print-table">
          <thead><tr><th>MENU</th><th className="text-right">QTY</th><th className="text-right">TOTAL</th></tr></thead>
          <tbody>
            {d.rekap.map((item, i) => (
              <tr key={i}>
                <td>{item.namaMenu}</td>
                <td className="text-right">{item.qtyTotal}</td>
                <td className="text-right">{item.pendapatanTotal.toLocaleString('id-ID')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="print-divider" />
        <div style={{ fontSize: '13px', fontWeight: 'bold', textAlign: 'center', marginBottom: '2px' }}>TOTAL PER METODE BAYAR</div>
        <div className="print-divider" />
        <div className="print-total">
          <div className="print-total-row"><span>CASH</span><span>Rp {d.totalCash.toLocaleString('id-ID')}</span></div>
          <div className="print-total-row"><span>QRIS</span><span>Rp {d.totalQRIS.toLocaleString('id-ID')}</span></div>
          <div className="print-total-row"><span>TRANSFER</span><span>Rp {d.totalTransfer.toLocaleString('id-ID')}</span></div>
        </div>
        <div className="print-divider" />
        <div className="print-total">
          <div className="print-total-row"><span>Total Qty:</span><span>{d.grandTotalQty} item</span></div>
          <div className="print-total-row"><span>Total Transaksi:</span><span>{d.jumlahTransaksi} transaksi</span></div>
          <div className="print-total-row grand"><span>GRAND TOTAL:</span><span>Rp {sesi.totalPendapatan.toLocaleString('id-ID')}</span></div>
        </div>
        <div className="print-divider" />
        <div className="print-footer">
          <p>*** REKAPITULASI RESMI ***</p>
          <p>Kasir Vian Jaya 08</p>
        </div>
      </div>
    </div>
  )
}
