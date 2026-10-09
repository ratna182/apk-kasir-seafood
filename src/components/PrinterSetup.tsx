'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { printer } from '../lib/printer'
import { loadPrinterConfig, clearPrinterConfig } from '../lib/printer/storage'
import type { PrinterConfig, PrinterStatus } from '../lib/printer/types'

interface PrinterSetupProps {
  open: boolean
  onClose: () => void
  onConfigured: (config: PrinterConfig | null) => void
}

export default function PrinterSetup({ open, onClose, onConfigured }: PrinterSetupProps) {
  const [status, setStatus] = useState<PrinterStatus>('idle')
  const [config, setConfig] = useState<PrinterConfig | null>(null)
  const [width, setWidth] = useState<'58mm' | '80mm'>('80mm')
  const [error, setError] = useState('')
  const [debugInfo, setDebugInfo] = useState('')
  const [availablePrinters, setAvailablePrinters] = useState<{ bluetooth: boolean; imin: boolean }>({ bluetooth: false, imin: false })

  useEffect(() => {
    if (!open) return
    const saved = loadPrinterConfig()
    if (saved) {
      setConfig(saved)
      setWidth(saved.width)
    }
    
    // Check available printers
    const available = printer.getAvailablePrinters()
    setAvailablePrinters(available)
    
    const unsub = printer.onStatusChange(setStatus)
    return unsub
  }, [open])

  const handleConnect = useCallback(async (type: 'bluetooth' | 'imin') => {
    setError('')
    setDebugInfo(`Menghubungkan ke ${type === 'imin' ? 'printer built-in' : 'printer Bluetooth'}...`)
    
    try {
      let ok: boolean
      if (type === 'imin') {
        ok = await printer.connectImin()
      } else {
        const cfg = loadPrinterConfig()
        ok = await printer.connectBluetooth(cfg || undefined)
      }
      
      if (ok) {
        const currentConfig = loadPrinterConfig()
        setConfig(currentConfig)
        onConfigured(currentConfig)
        setDebugInfo('Printer berhasil terhubung!')
      } else {
        const errorMsg = printer.error || 'Printer tidak ditemukan.'
        setError(errorMsg)
        setDebugInfo(`Gagal: ${errorMsg}`)
      }
    } catch (e) {
      setError('Terjadi kesalahan saat menghubungkan printer.')
      setDebugInfo(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [onConfigured])

  const handleDisconnect = useCallback(async () => {
    await printer.disconnect()
    setConfig(null)
    clearPrinterConfig()
    onConfigured(null)
    setDebugInfo('')
  }, [onConfigured])

  const handleForceReconnect = useCallback(async () => {
    setError('')
    setDebugInfo('Menyambungkan ulang printer...')
    try {
      const ok = await printer.forceReconnect()
      if (ok) {
        setDebugInfo('Reconnect berhasil!')
      } else {
        setError(printer.error || 'Reconnect gagal')
        setDebugInfo(`Reconnect gagal: ${printer.error}`)
      }
    } catch (e) {
      setError('Terjadi kesalahan saat reconnect.')
      setDebugInfo(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  if (!open) return null

  return (
    <div className="modal-overlay no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000 }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '400px', border: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Setup Printer</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--color-text)' }}>&times;</button>
        </div>

        {config ? (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-success-soft, #d4edda)', borderRadius: '8px', border: '1px solid var(--color-success, #28a745)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#28a745', display: 'inline-block' }} />
                <span style={{ fontWeight: 700 }}>{config.deviceName}</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#28a745', fontWeight: 600 }}>{status.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
              Printer terhubung ({config.connectionType === 'imin' ? 'Built-in' : 'Bluetooth'})
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-bg-secondary, #f8f9fa)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc3545', display: 'inline-block' }} />
              <span style={{ fontWeight: 600 }}>Belum terhubung</span>
            </div>
          </div>
        )}

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>Ukuran Kertas</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['58mm', '80mm'] as const).map((w) => (
              <button key={w} type="button" onClick={() => setWidth(w)} style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: `2px solid ${width === w ? 'var(--color-brand)' : 'var(--color-border)'}`, background: width === w ? 'var(--color-brand-soft, #e7f1ff)' : 'transparent', fontWeight: width === w ? 700 : 500, cursor: 'pointer', fontSize: '0.9rem' }}>
                {w}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: '1rem', padding: '0.5rem', background: 'var(--color-danger-soft, #f8d7da)', borderRadius: '6px', color: 'var(--color-danger, #dc3545)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {debugInfo && (
          <div style={{ marginBottom: '1rem', padding: '0.5rem', background: 'var(--color-bg-secondary, #f8f9fa)', borderRadius: '6px', fontSize: '0.75rem', color: '#666', fontFamily: 'monospace' }}>
            {debugInfo}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {!config ? (
            <>
              {availablePrinters.imin && (
                <button type="button" onClick={() => handleConnect('imin')} disabled={status === 'connecting'} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: 'none', background: 'var(--color-brand)', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: status === 'connecting' ? 'wait' : 'pointer', opacity: status === 'connecting' ? 0.7 : 1 }}>
                  {status === 'connecting' ? 'Menyambungkan...' : 'Gunakan Printer Built-in (iMin)'}
                </button>
              )}
              {availablePrinters.bluetooth && (
                <button type="button" onClick={() => handleConnect('bluetooth')} disabled={status === 'connecting'} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: 'none', background: availablePrinters.imin ? 'var(--color-bg-secondary, #f8f9fa)' : 'var(--color-brand)', color: availablePrinters.imin ? 'var(--color-text)' : '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: status === 'connecting' ? 'wait' : 'pointer', opacity: status === 'connecting' ? 0.7 : 1 }}>
                  {status === 'connecting' ? 'Menyambungkan...' : 'Hubungkan Printer Bluetooth'}
                </button>
              )}
              {!availablePrinters.imin && !availablePrinters.bluetooth && (
                <div style={{ padding: '0.75rem', background: 'var(--color-warning-soft, #fff3cd)', borderRadius: '8px', border: '1px solid var(--color-warning, #ffc107)', fontSize: '0.85rem' }}>
                  Tidak ada printer yang tersedia. Pastikan perangkat mendukung Bluetooth atau iMin SDK.
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button type="button" onClick={handleDisconnect} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '2px solid var(--color-danger, #dc3545)', background: 'transparent', color: 'var(--color-danger, #dc3545)', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}>
                Putuskan Koneksi
              </button>
              <button type="button" onClick={handleForceReconnect} disabled={status === 'connecting'} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: 'none', background: 'var(--color-warning, #ffc107)', color: '#000', fontWeight: 700, fontSize: '0.95rem', cursor: status === 'connecting' ? 'wait' : 'pointer', opacity: status === 'connecting' ? 0.7 : 1 }}>
                {status === 'connecting' ? 'Menyambungkan ulang...' : '🔄 Reconnect Printer'}
              </button>
            </div>
          )}
          <Link href="/printer-test" onClick={onClose} style={{ display: 'block', width: '100%', marginTop: '0.5rem', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary, #666)', textAlign: 'center', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
            Buka Diagnostik Printer
          </Link>
        </div>

        <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--color-text-muted, #999)', textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.25rem' }}>Printer Built-in: iMin D4 505 (otomatis terdeteksi)</p>
          <p style={{ margin: 0 }}>Bluetooth: Blueprint ECO 80D/X atau ESC/POS compatible</p>
        </div>
      </div>
    </div>
  )
}
