'use client'

import { useState, useEffect, useCallback } from 'react'
import { printer } from '../lib/printer'
import { loadPrinterConfig } from '../lib/printer/storage'
import type { PrinterStatus, PrinterConfig } from '../lib/printer/types'

interface PrinterStatusBadgeProps {
  onSetupClick: () => void
}

const STATUS_MAP: Record<PrinterStatus, { color: string; label: string }> = {
  idle: { color: '#dc3545', label: 'Terputus' },
  connecting: { color: '#ffc107', label: 'Menyambungkan...' },
  connected: { color: '#28a745', label: 'Terhubung' },
  error: { color: '#dc3545', label: 'Error' },
  unsupported: { color: '#6c757d', label: 'Tidak Didukung' },
}

export default function PrinterStatusBadge({ onSetupClick }: PrinterStatusBadgeProps) {
  const [status, setStatus] = useState<PrinterStatus>('idle')
  const [deviceName, setDeviceName] = useState('')

  useEffect(() => {
    const saved = loadPrinterConfig()
    if (saved) setDeviceName(saved.deviceName)
    const unsub = printer.onStatusChange(setStatus)
    return unsub
  }, [])

  const info = STATUS_MAP[status]

  return (
    <button
      type="button"
      onClick={onSetupClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.3rem 0.6rem',
        borderRadius: '6px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        color: 'var(--color-text)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: info.color, display: 'inline-block' }} />
      <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {status === 'connected' && deviceName ? deviceName : info.label}
      </span>
    </button>
  )
}
