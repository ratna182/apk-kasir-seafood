'use client'

import { useEffect, useState } from 'react'
import { printer } from '@/lib/printer'
import { iminPrinter } from '@/lib/printer/imin-sdk'
import { compose, drawLine, feedAndCut, initPrinter, setAlign, setBold, setText } from '@/lib/printer/escpos'

export default function PrinterTestPage() {
  const [status, setStatus] = useState('idle')
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [bridgeAvailable, setBridgeAvailable] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (message: string) => setLogs((current) => [`${new Date().toLocaleTimeString()} ${message}`, ...current].slice(0, 20))

  async function refreshNativeInfo() {
    const available = iminPrinter.isSupported()
    setBridgeAvailable(available)
    const rawVersion = await iminPrinter.getAppVersion()
    if (rawVersion) {
      try {
        const version = JSON.parse(rawVersion) as { versionName?: string; versionCode?: number }
        setAppVersion(`${version.versionName || '-'} (code ${version.versionCode ?? '-'})`)
      } catch {
        setAppVersion(rawVersion)
      }
    }
    if (available) {
      const rawDiagnostics = await iminPrinter.getDiagnostics()
      if (rawDiagnostics) {
        try {
          setDiagnostics(JSON.parse(rawDiagnostics) as Record<string, unknown>)
        } catch {
          setDiagnostics({ errorMessage: rawDiagnostics })
        }
      }
    }
  }

  useEffect(() => {
    refreshNativeInfo()
    const retry = window.setTimeout(refreshNativeInfo, 1000)
    return () => window.clearTimeout(retry)
  }, [])

  async function connect() {
    const connected = await printer.connectImin()
    const nextStatus = await iminPrinter.getStatus()
    setStatus(nextStatus)
    addLog(`connect ok=${connected} status=${nextStatus}`)
    await refreshNativeInfo()
  }

  async function printTest() {
    if (status !== 'connected') {
      await refreshNativeInfo()
      addLog('cetak dibatalkan: Connect belum sukses; lihat diagnostik di atas')
      return
    }
    const jobId = `printer-test-${Date.now()}`
    const data = compose(initPrinter(), setAlign('center'), setBold(true), setText('IMIN PRINTER TEST\n'), setBold(false), setAlign('left'), setText(`${drawLine(32)}\n`), setText('Kolom kiri                 Rp 10.000\n'), setText('Qty 2                      Rp 20.000\n'), setText(`${drawLine(32)}\nTOTAL                      Rp 30.000\n`), feedAndCut(3))
    const result = await printer.printReceipt(data, jobId)
    const text = typeof result === 'boolean' ? `ok=${result}` : `job=${jobId} ${JSON.stringify(result)}`
    setLogs((current) => [text, ...current].slice(0, 20))
  }

  async function copyLogs() {
    await navigator.clipboard?.writeText(logs.join('\n'))
    addLog('log disalin')
  }

  return <main style={{ maxWidth: 640, margin: '2rem auto', padding: '1rem' }}>
    <h1>Printer Test</h1>
    <p>APK: <strong>{appVersion || 'Web/browser'}</strong></p>
    <p>Bridge: <strong>{bridgeAvailable ? 'tersedia' : 'tidak tersedia'}</strong></p>
    <p>Status: <strong>{status}</strong></p>
    {diagnostics && <pre aria-label="Diagnostik native">{['stage', 'bindResult', 'servicePackageInstalled', 'statusCode', 'statusText', 'errorClass', 'errorMessage'].map((key) => `${key}: ${String(diagnostics[key] ?? '-')}`).join('\n')}</pre>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" onClick={connect}>Connect</button>
      <button type="button" onClick={printTest}>Cetak Struk Uji</button>
      <button type="button" onClick={copyLogs}>Salin</button>
    </div>
    <pre aria-live="polite">{logs.join('\n')}</pre>
  </main>
}
