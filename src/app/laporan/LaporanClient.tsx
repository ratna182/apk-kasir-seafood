'use client'

import { useState, useEffect } from 'react'
import { FileSpreadsheet, FileText, Printer, Lock, AlertTriangle } from 'lucide-react'
import PrinterSetup from '@/components/PrinterSetup'
import PrinterStatusBadge from '@/components/PrinterStatus'
import { printer } from '@/lib/printer'
import { loadPrinterConfig } from '@/lib/printer/storage'
import { encodeLaporan } from '@/lib/printer/laporan-encoder'

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

interface AktivitasKasirItem {
  waktu: string
  kasir: string
  aktivitas: string
  detail: string | null
}

interface LaporanDataLocal {
  tanggal: string
  warung: { id: string; nama: string; kode: string; alamat?: string | null }
  rekap: RekapItem[]
  transaksi: TransaksiItem[]
  grandTotalQty: number
  grandTotalPendapatan: number
  jumlahTransaksi: number
  totalCash: number
  totalQRIS: number
  totalTransfer: number
  aktivitasKasir: AktivitasKasirItem[]
}

interface KasirSesiInfo {
  ditutupPada: string
  ditutupOleh: string
  totalTransaksi: number
  totalPendapatan: number
}

interface WarungOption { id: string; nama: string; kode: string }

interface LaporanClientProps {
  warungId: string
  warungNama: string
  warungKode: string
  warungs: WarungOption[]
  role: string
  initialData: LaporanDataLocal | null
  initialKasirSesi: KasirSesiInfo | null
}

export default function LaporanClient({ warungId, warungNama, warungKode, warungs, role, initialData, initialKasirSesi }: LaporanClientProps) {
  const [data, setData] = useState<LaporanDataLocal | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [kasirSesi, setKasirSesi] = useState<KasirSesiInfo | null>(initialKasirSesi)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closing, setClosing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [selectedWarungId, setSelectedWarungId] = useState(warungId)
  const [currentWarungNama, setCurrentWarungNama] = useState(warungNama)
  const [showPrinterSetup, setShowPrinterSetup] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printerWidth, setPrinterWidth] = useState<'58mm' | '80mm'>('80mm')
  const isOwner = role === 'OWNER'

  useEffect(() => {
    const saved = loadPrinterConfig()
    if (saved) {
      setPrinterWidth(saved.width)
      printer.autoReconnect()
    }
  }, [])

  // Refresh the report on branch changes; polling only needs cashier status.
  useEffect(() => {
    let cancelled = false
    const updateStatus = async () => {
      try {
        const statusRes = await fetch(`/api/kasir/status?${new URLSearchParams({ warungId: selectedWarungId })}`)
        if (cancelled) return
        const statusResult = await statusRes.json()
        if (statusResult.success) {
          setKasirSesi(statusResult.data.sudahTutup ? {
            ditutupPada: statusResult.data.ditutupPada,
            ditutupOleh: 'Kasir',
            totalTransaksi: statusResult.data.totalTransaksi,
            totalPendapatan: statusResult.data.totalPendapatan,
          } : null)
        }
      } catch { /* silent */ }
    }

    const loadBranch = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ warung_id: selectedWarungId })
        const [laporanRes, statusRes] = await Promise.all([
          fetch(`/api/laporan/harian?${params}`),
          fetch(`/api/kasir/status?${new URLSearchParams({ warungId: selectedWarungId })}`),
        ])
        const [laporanResult, statusResult] = await Promise.all([laporanRes.json(), statusRes.json()])
        if (cancelled) return
        if (laporanResult.success) setData(laporanResult.data)
        if (statusResult.success) {
          setKasirSesi(statusResult.data.sudahTutup ? {
            ditutupPada: statusResult.data.ditutupPada,
            ditutupOleh: 'Kasir',
            totalTransaksi: statusResult.data.totalTransaksi,
            totalPendapatan: statusResult.data.totalPendapatan,
          } : null)
        }
      } catch {
        if (!cancelled) setFeedback({ type: 'error', message: 'Gagal memuat data cabang' })
      } finally { if (!cancelled) setLoading(false) }
    }

    if (isOwner && selectedWarungId !== warungId) void loadBranch()
    else void updateStatus()
    const interval = setInterval(() => void updateStatus(), 10_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [selectedWarungId, warungId, isOwner])

  async function fetchLaporan() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ warung_id: selectedWarungId })
      const res = await fetch(`/api/laporan/harian?${params}`)
      const result = await res.json()
      if (result.success) setData(result.data)
      else setFeedback({ type: 'error', message: result.message || 'Gagal memuat laporan' })
    } catch {
      setFeedback({ type: 'error', message: 'Koneksi ke server terganggu' })
    } finally { setLoading(false) }
  }

  async function checkKasirStatus() {
    const params = new URLSearchParams({ warungId: selectedWarungId })
    const res = await fetch(`/api/kasir/status?${params}`)
    const result = await res.json()
    if (!result.success) return false
    const closedSession = result.data.sudahTutup ? {
      ditutupPada: result.data.ditutupPada,
      ditutupOleh: 'Kasir',
      totalTransaksi: result.data.totalTransaksi,
      totalPendapatan: result.data.totalPendapatan,
    } : null
    setKasirSesi(closedSession)
    return Boolean(closedSession)
  }

  async function handleTutupKasir() {
    setClosing(true)
    try {
      const res = await fetch('/api/kasir/tutup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: selectedWarungId }),
      })
      const result = await res.json()
      if (result.success) {
        setKasirSesi({ ditutupPada: result.data.ditutupPada, ditutupOleh: currentWarungNama, totalTransaksi: result.data.totalTransaksi, totalPendapatan: result.data.totalPendapatan })
        setShowCloseModal(false)
        setFeedback({ type: 'success', message: 'Kasir hari ini telah berhasil ditutup! Anda dapat mencetak laporan penutupan sekarang.' })
        fetchLaporan()
      } else {
        setFeedback({ type: 'error', message: result.message || 'Gagal menutup kasir' })
        setShowCloseModal(false)
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem saat menutup kasir' })
      setShowCloseModal(false)
    } finally { setClosing(false) }
  }

  async function handleBukaKasir() {
    if (!confirm('Yakin ingin membuka kasir hari ini? Kasir akan bisa bertransaksi lagi.')) return
    setOpening(true)
    try {
      const res = await fetch('/api/kasir/buka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: selectedWarungId }),
      })
      const result = await res.json()
      if (result.success) {
        setKasirSesi(null)
        setFeedback({ type: 'success', message: 'Kasir hari ini berhasil dibuka kembali!' })
        fetchLaporan()
      } else {
        setFeedback({ type: 'error', message: result.message || 'Gagal membuka kasir' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem saat membuka kasir' })
    } finally { setOpening(false) }
  }

  function handlePrint() {
    if (!kasirSesi) {
      setFeedback({ type: 'error', message: 'Tutup kasir terlebih dahulu sebelum mencetak laporan.' })
      return
    }
    const printWindow = window.open('', '_blank', 'width=280,height=500')
    if (printWindow) {
      const receiptEl = document.querySelector('.print-receipt')
      const receiptHTML = receiptEl ? receiptEl.outerHTML : ''
      printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cetak Laporan</title><style>@page{size:auto;margin:0}*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;margin:0;padding:0}body{width:100%;margin:0;padding:0 2mm;font-family:'Helvetica','Arial',sans-serif;font-size:15px;font-weight:bold;color:black;background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-receipt{width:100%;padding:0 2mm;text-align:center}.print-header{text-align:center;margin-bottom:3px}.receipt-logo{display:block;width:1.7cm;height:1.7cm;object-fit:contain;margin:0 auto 3px}.receipt-socials{text-align:center}.receipt-socials p{display:block;margin:0;text-align:center}.print-header h2{font-size:18px;text-transform:uppercase;margin:0 0 2px;line-height:1.3}.print-header p{font-size:14px;margin:0;line-height:1.3}.print-divider{border:none;border-top:1px dashed black;margin:3px 0}.print-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:2px}.print-table{page-break-inside:auto}.print-table thead{display:table-header-group}.print-table tr{page-break-inside:avoid;break-inside:avoid}.print-table th,.print-table td{padding:1px 0;line-height:1.4;overflow-wrap:anywhere}.print-table th{border-bottom:1px dashed black;font-size:13px}.text-right{text-align:right}.print-total{margin-top:3px;border-top:1px dashed black;padding-top:3px}.print-total-row{display:flex;justify-content:space-between;font-size:14px;line-height:1.4}.print-total-row.grand{font-size:17px;font-weight:800;margin-top:1px}.print-footer{text-align:center;margin-top:3px;margin-bottom:0;padding-bottom:0;font-size:14px;line-height:1.4}.print-footer p{margin:0;line-height:1.4}@media print{body{width:100%}.print-receipt{width:100%}}</style></head><body>${receiptHTML}</body></html>`)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => { printWindow.print() }, 300)
    }
  }

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

  async function handlePrintThermal() {
    if (!data) return
    if (!kasirSesi || !await checkKasirStatus()) {
      setFeedback({ type: 'error', message: 'Tutup kasir terlebih dahulu sebelum mencetak laporan.' })
      return
    }
    setPrinting(true)
    try {
      const encoded = encodeLaporan(data, currentWarungNama, data.warung.alamat ?? null, printerWidth, kasirSesi)
      const success = await handlePrintWithRetry(encoded)
      if (success) {
        setFeedback({ type: 'success', message: 'Laporan berhasil dicetak.' })
      } else {
        handlePrint()
      }
    } catch {
      setFeedback({ type: 'error', message: 'Gagal mencetak laporan.' })
    } finally { setPrinting(false) }
  }

  async function handleExportExcel() {
    if (!kasirSesi) {
      setFeedback({ type: 'error', message: 'Tutup kasir terlebih dahulu sebelum mencetak laporan.' })
      return
    }
    try {
      const params = new URLSearchParams({ warung_id: selectedWarungId })
      const res = await fetch(`/api/laporan/export?${params}`)
      if (!res.ok) throw new Error('Gagal export')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `laporan-${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setFeedback({ type: 'success', message: 'Berhasil download laporan Excel!' })
    } catch { setFeedback({ type: 'error', message: 'Gagal export laporan Excel' }) }
  }

  async function handleExportPDF() {
    if (!kasirSesi) {
      setFeedback({ type: 'error', message: 'Tutup kasir terlebih dahulu sebelum mencetak laporan.' })
      return
    }
    try {
      const params = new URLSearchParams({ warung_id: selectedWarungId })
      const res = await fetch(`/api/laporan/export/pdf?${params}`)
      if (!res.ok) throw new Error('Gagal export')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `laporan-${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setFeedback({ type: 'success', message: 'Berhasil download laporan PDF!' })
    } catch { setFeedback({ type: 'error', message: 'Gagal export laporan PDF' }) }
  }

  const now = new Date()
  const todayStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div>
      {/* Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Laporan Penjualan Harian</h1>
          <p className="text-secondary text-sm">{todayStr} • {currentWarungNama}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {isOwner && (
            <select
              className="form-input"
              style={{ minWidth: '180px', padding: '0.4rem 0.5rem', fontSize: '0.85rem' }}
              value={selectedWarungId}
              onChange={(e) => {
                const newId = e.target.value
                setSelectedWarungId(newId)
                const found = warungs?.find(w => w.id === newId)
                if (found) setCurrentWarungNama(found.nama)
              }}
            >
              {warungs?.map(w => (
                <option key={w.id} value={w.id}>{w.nama}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={handleExportExcel} disabled={loading || !data || data.rekap.length === 0 || !kasirSesi} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button type="button" onClick={handleExportPDF} disabled={loading || !data || data.rekap.length === 0 || !kasirSesi} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={16} /> Export PDF
          </button>
          <button type="button" onClick={handlePrintThermal} disabled={loading || !data || data.rekap.length === 0 || printing || !kasirSesi} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <Printer size={16} /> {printing ? 'Mencetak...' : 'Cetak Laporan'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {(['58mm', '80mm'] as const).map((w) => (
              <button key={w} type="button" onClick={() => setPrinterWidth(w)} className={`btn btn-sm ${printerWidth === w ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
                {w}
              </button>
            ))}
          </div>
          <PrinterStatusBadge onSetupClick={() => setShowPrinterSetup(true)} />
          {!kasirSesi ? (
            <button type="button" onClick={() => setShowCloseModal(true)} disabled={loading} className="btn btn-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={16} /> Tutup Kasir Hari Ini
            </button>
          ) : (
            <button type="button" onClick={handleBukaKasir} disabled={opening} className="btn btn-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={16} /> {opening ? 'Membuka...' : 'Buka Kasir Lagi'}
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`alert no-print ${feedback.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1.25rem' }}>
          <div>{feedback.message}</div>
        </div>
      )}

      {/* Status Kasir */}
      {kasirSesi ? (
        <div className="alert alert-warning no-print" style={{ marginBottom: '1.5rem' }}>
          <div>
            <strong>Status Kasir: Ditutup</strong>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Shift kasir hari ini telah resmi ditutup pada{' '}
              <strong>{new Date(kasirSesi.ditutupPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</strong>{' '}
              oleh <strong>{kasirSesi.ditutupOleh}</strong>.
            </p>
          </div>
        </div>
      ) : (
        <div className="alert alert-success no-print" style={{ marginBottom: '1.5rem' }}>
          <div>
            <strong>Status Kasir: Buka</strong>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>Kasir aktif beroperasi menerima pesanan. Anda dapat menutup shift kasir di akhir hari.</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
        <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-brand)', fontFamily: "var(--font-fraunces), serif" }}>
            {data ? data.jumlahTransaksi : '...'}
          </div>
          <div className="text-sm text-muted">Jumlah Transaksi</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif" }}>
            {data ? data.grandTotalQty : '...'}
          </div>
          <div className="text-sm text-muted">Total Porsi / Item Terjual</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1.25rem' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>
            {data ? `Rp ${data.grandTotalPendapatan.toLocaleString('id-ID')}` : '...'}
          </div>
          <div className="text-sm text-muted">Total Pendapatan Hari Ini</div>
        </div>
      </div>

      {/* Payment Method Cards */}
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ textAlign: 'center', padding: '1rem', borderLeft: '3px solid var(--color-success)' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif" }}>
            {data ? `Rp ${(data.totalCash || 0).toLocaleString('id-ID')}` : '...'}
          </div>
          <div className="text-xs text-muted">Cash</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1rem', borderLeft: '3px solid var(--color-warning)' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-warning)', fontFamily: "var(--font-fraunces), serif" }}>
            {data ? `Rp ${(data.totalQRIS || 0).toLocaleString('id-ID')}` : '...'}
          </div>
          <div className="text-xs text-muted">QRIS</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '1rem', borderLeft: '3px solid var(--color-info)' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-info)', fontFamily: "var(--font-fraunces), serif" }}>
            {data ? `Rp ${(data.totalTransfer || 0).toLocaleString('id-ID')}` : '...'}
          </div>
          <div className="text-xs text-muted">Transfer</div>
        </div>
      </div>

      {/* Table */}
      <div className="no-print">
        {loading ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <p className="text-secondary">Menghitung rekapitulasi data penjualan...</p>
          </div>
        ) : !data || data.rekap.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1rem' }}>
            <h3>Belum Ada Transaksi Hari Ini</h3>
            <p className="text-secondary text-sm" style={{ maxWidth: '400px', margin: '0 auto' }}>
              Saat kasir mencatat transaksi pesanan baru, rekapitulasi menu dan pendapatan akan otomatis muncul di sini.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-raised)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1rem', margin: 0, fontWeight: 700 }}>Rincian Penjualan Per Menu</h2>
              <span className="text-xs text-secondary">{data.rekap.length} jenis menu terjual</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-raised)', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '0.85rem 1.25rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Nama Menu</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Kategori</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Qty Terjual</th>
                    <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Subtotal (Rp)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rekap.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)', transition: 'var(--transition)' }}>
                      <td style={{ padding: '0.9rem 1.25rem', fontWeight: 600 }}>{item.namaMenu}</td>
                      <td style={{ padding: '0.9rem 1rem' }}>
                        <span className="badge" style={{ background: item.kategori === 'MAKANAN' ? 'var(--color-brand-light)' : 'var(--color-success-light)', color: item.kategori === 'MAKANAN' ? 'var(--color-brand)' : 'var(--color-success)', fontSize: '0.75rem' }}>
                          {item.kategori === 'MAKANAN' ? 'Makanan' : 'Minuman'}
                        </span>
                      </td>
                      <td style={{ padding: '0.9rem 1rem', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{item.qtyTotal}</td>
                      <td style={{ padding: '0.9rem 1.25rem', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>
                        Rp {item.pendapatanTotal.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--color-surface-raised)', borderTop: '2px solid var(--color-border)', fontWeight: 800 }}>
                    <td colSpan={2} style={{ padding: '1rem 1.25rem', fontSize: '0.95rem' }}>GRAND TOTAL</td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontSize: '1.1rem', color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{data.grandTotalQty}</td>
                    <td style={{ padding: '1rem 1.25rem', textAlign: 'right', fontSize: '1.25rem', color: 'var(--color-success)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>
                      Rp {data.grandTotalPendapatan.toLocaleString('id-ID')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal Tutup Kasir */}
      {showCloseModal && (
        <div className="modal-overlay no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000, animation: 'fadeIn 0.2s ease-out' }}>
          <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-danger)', animation: 'scaleIn 0.2s ease-out' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <AlertTriangle size={40} style={{ color: 'var(--color-danger)', marginBottom: '0.5rem' }} />
              <h2 style={{ fontSize: '1.25rem', margin: '0 0 6px', color: 'var(--color-danger)' }}>Konfirmasi Tutup Kasir</h2>
              <p className="text-secondary text-sm">Apakah Anda yakin ingin menutup kasir hari ini?</p>
            </div>
            <div style={{ padding: '1rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem', fontSize: '0.85rem', lineHeight: '1.5' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span className="text-secondary">Total Transaksi:</span>
                <strong>{data?.jumlahTransaksi || 0} transaksi</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span className="text-secondary">Total Pendapatan:</span>
                <strong style={{ color: 'var(--color-success)', fontVariantNumeric: 'tabular-nums' }}>Rp {(data?.grandTotalPendapatan || 0).toLocaleString('id-ID')}</strong>
              </div>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '8px', color: 'var(--color-pending)', fontSize: '0.8rem' }}>
                <strong>Perhatian:</strong> Setelah ditutup, transaksi baru <strong>tidak dapat dibuat</strong> hingga esok hari.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowCloseModal(false)} disabled={closing} className="btn btn-ghost">Batal</button>
              <button type="button" onClick={handleTutupKasir} disabled={closing} className="btn btn-danger" style={{ minWidth: '130px', justifyContent: 'center' }}>
                {closing ? 'Memproses...' : 'Ya, Tutup Kasir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Receipt */}
      {data && (
        <div className="print-only print-receipt">
          <div className="print-header">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="receipt-logo" src="/logo-struk.webp" alt="Seafood 08 Vian Jaya" style={{ display: 'block', width: '1.7cm', height: '1.7cm', objectFit: 'contain', margin: '0 auto 3px' }} />
            {data.warung.alamat && <p>{data.warung.alamat}</p>}
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
            <div>Tanggal: {data.tanggal}</div>
            <div>Dicetak: {new Date().toLocaleTimeString('id-ID')} | Cabang: {currentWarungNama}</div>
            {kasirSesi && (
              <>
                <div>Status: SUDAH DITUTUP</div>
                <div>Pkl: {new Date(kasirSesi.ditutupPada).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
              </>
            )}
          </div>
          <div className="print-divider" />
          <div style={{ fontSize: '13px', fontWeight: 'bold', textAlign: 'center', marginBottom: '2px' }}>DAFTAR TRANSAKSI</div>
          <div className="print-divider" />
          <table className="print-table">
            <thead><tr><th>MEJA</th><th>WAKTU</th><th>METODE</th><th className="text-right">TOTAL</th></tr></thead>
            <tbody>
              {data.transaksi.map((tx, idx) => (
                <tr key={idx}>
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
              <tr>
                <td style={{ fontWeight: 'bold' }}>Buka Kasir</td>
                <td className="text-right">{(() => { const a = data.aktivitasKasir.filter(x => x.aktivitas === 'BUKA_KASIR').pop(); return a ? new Date(a.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-' })()}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 'bold' }}>Tutup Kasir</td>
                <td className="text-right">{(() => { const a = data.aktivitasKasir.filter(x => x.aktivitas === 'TUTUP_KASIR').pop(); return a ? new Date(a.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-' })()}</td>
              </tr>
            </tbody>
          </table>
          <div className="print-divider" />
          <div style={{ fontSize: '13px', fontWeight: 'bold', textAlign: 'center', marginBottom: '2px' }}>REKAP MENU</div>
          <div className="print-divider" />
          <table className="print-table">
            <thead><tr><th>MENU</th><th className="text-right">QTY</th><th className="text-right">TOTAL</th></tr></thead>
            <tbody>
              {data.rekap.map((item, idx) => (
                <tr key={idx}>
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
            <div className="print-total-row"><span>CASH</span><span>Rp {data.totalCash.toLocaleString('id-ID')}</span></div>
            <div className="print-total-row"><span>QRIS</span><span>Rp {data.totalQRIS.toLocaleString('id-ID')}</span></div>
            <div className="print-total-row"><span>TRANSFER</span><span>Rp {data.totalTransfer.toLocaleString('id-ID')}</span></div>
          </div>
          <div className="print-divider" />
          <div className="print-total">
            <div className="print-total-row"><span>Total Qty:</span><span>{data.grandTotalQty} item</span></div>
            <div className="print-total-row"><span>Total Transaksi:</span><span>{data.jumlahTransaksi} transaksi</span></div>
            <div className="print-total-row grand"><span>GRAND TOTAL:</span><span>Rp {data.grandTotalPendapatan.toLocaleString('id-ID')}</span></div>
          </div>
          <div className="print-divider" />
          <div className="print-footer">
            <p>*** REKAPITULASI RESMI ***</p>
            <p>Kasir Vian Jaya 08</p>
          </div>
        </div>
      )}

      <PrinterSetup open={showPrinterSetup} onClose={() => setShowPrinterSetup(false)} onConfigured={(config) => { if (config) setPrinterWidth(config.width) }} />
    </div>
  )
}
