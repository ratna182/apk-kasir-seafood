'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Lock } from 'lucide-react'
import { formatWibDateTime } from '@/lib/time'

export interface OpenShiftInfo {
  id: string
  warungId: string
  warungNama: string
  dibukaPada: string | null
  dibukaOleh: string
  durationHours: number
  overtime: boolean
  totalTransaksi: number
  totalPendapatan: number
}

interface ForceCloseShiftProps {
  shifts: OpenShiftInfo[]
}

function durationLabel(hours: number): string {
  const minutes = Math.max(0, Math.floor(hours * 60))
  return `${Math.floor(minutes / 60)}j ${minutes % 60}m`
}

export default function ForceCloseShift({ shifts }: ForceCloseShiftProps) {
  const router = useRouter()
  const [target, setTarget] = useState<OpenShiftInfo | null>(null)
  const [catatan, setCatatan] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overtimeShifts = shifts.filter((shift) => shift.overtime)

  async function submit() {
    if (!target) return
    if (catatan.trim().length < 5) {
      setError('Catatan wajib diisi minimal 5 karakter.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/kasir/tutup-paksa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: target.warungId, catatan: catatan.trim() }),
      })
      const result = await res.json()
      if (!result.success) {
        setError(result.message || 'Gagal menutup paksa shift.')
        return
      }
      setTarget(null)
      setCatatan('')
      router.refresh()
    } catch {
      setError('Terjadi kesalahan saat menutup paksa shift.')
    } finally {
      setSubmitting(false)
    }
  }

  if (shifts.length === 0) return null

  return (
    <div style={{ marginBottom: '2rem' }}>
      {overtimeShifts.length > 0 && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          <div>
            <strong>Peringatan: {overtimeShifts.length} shift melewati 18 jam</strong>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Tutup paksa shift berikut atau minta kasir menutup shift. Catatan wajib diisi dan tersimpan di log shift.
            </p>
          </div>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-raised)' }}>
          <h2 style={{ fontSize: '1rem', margin: 0, fontWeight: 700 }}>Shift Sedang Buka</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-raised)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '0.8rem 1.25rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Warung</th>
                <th style={{ padding: '0.8rem 1rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Dibuka</th>
                <th style={{ padding: '0.8rem 1rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Kasir</th>
                <th style={{ padding: '0.8rem 1rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Durasi</th>
                <th style={{ padding: '0.8rem 1.25rem', textAlign: 'right', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.85rem 1.25rem', fontWeight: 600 }}>{shift.warungNama}</td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{formatWibDateTime(shift.dibukaPada)} WIB</td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem' }}>{shift.dibukaOleh}</td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 700, color: shift.overtime ? 'var(--color-danger)' : 'inherit' }}>
                    {durationLabel(shift.durationHours)}{shift.overtime ? ' • OVERTIME' : ''}
                  </td>
                  <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => { setTarget(shift); setCatatan(''); setError(null) }} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Lock size={14} /> Tutup Paksa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {target && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000 }}>
          <div className="card" style={{ width: '100%', maxWidth: '460px', padding: '1.75rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-danger)' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <AlertTriangle size={40} style={{ color: 'var(--color-danger)', marginBottom: '0.5rem' }} />
              <h2 style={{ fontSize: '1.25rem', margin: '0 0 6px', color: 'var(--color-danger)' }}>Tutup Paksa Shift</h2>
              <p className="text-secondary text-sm">
                {target.warungNama} • dibuka {formatWibDateTime(target.dibukaPada)} WIB oleh {target.dibukaOleh}
              </p>
            </div>
            <div style={{ padding: '1rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Durasi shift:</span>
                <strong style={{ color: target.overtime ? 'var(--color-danger)' : 'inherit' }}>{durationLabel(target.durationHours)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Transaksi selesai:</span>
                <strong>{target.totalTransaksi}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Pendapatan:</span>
                <strong>Rp {target.totalPendapatan.toLocaleString('id-ID')}</strong>
              </div>
            </div>
            <label htmlFor="catatan-paksa" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Catatan (wajib)
            </label>
            <textarea
              id="catatan-paksa"
              className="form-input"
              rows={3}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Contoh: kasir lupa menutup shift, sudah dikonfirmasi via telepon."
              style={{ width: '100%', marginBottom: '0.5rem', resize: 'vertical' }}
            />
            <p className="text-xs text-muted" style={{ marginBottom: '0.75rem' }}>
              Pesanan yang belum dibayar pada shift ini akan dibatalkan. Catatan disimpan permanen di log shift.
            </p>
            {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}><div>{error}</div></div>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setTarget(null)} disabled={submitting}>Batal</button>
              <button type="button" className="btn btn-danger" onClick={submit} disabled={submitting} style={{ minWidth: '150px', justifyContent: 'center' }}>
                {submitting ? 'Memproses...' : 'Tutup Paksa Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
