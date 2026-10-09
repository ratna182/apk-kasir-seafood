'use client'

import { useState } from 'react'
import { printer } from '@/lib/printer'
import { iminPrinter } from '@/lib/printer/imin-sdk'
import { compose, drawLine, feedAndCut, initPrinter, setAlign, setBold, setText } from '@/lib/printer/escpos'

export default function PrinterTestPage() {
  const [status, setStatus] = useState('idle')
  const [logs, setLogs] = useState<string[]>([])

  const addLog = (message: string) => setLogs((current) => [`${new Date().toLocaleTimeString()} ${message}`, ...current].slice(0, 20))

  async function connect() {
    const connected = await printer.connectImin()
    const nextStatus = await iminPrinter.getStatus()
    setStatus(nextStatus)
    addLog(`connect ok=${connected} status=${nextStatus}`)
  }

  async function printTest() {
    const jobId = `printer-test-${Date.now()}`
    const data = compose(initPrinter(), setAlign('center'), setBold(true), setText('IMIN PRINTER TEST\n'), setBold(false), setAlign('left'), setText(`${drawLine(32)}\n`), setText('Kolom kiri                 Rp 10.000\n'), setText('Qty 2                      Rp 20.000\n'), setText(`${drawLine(32)}\nTOTAL                      Rp 30.000\n`), feedAndCut(3))
    const result = await printer.printReceipt(data, jobId)
    const text = typeof result === 'boolean' ? `ok=${result}` : `job=${jobId} attempts=${result.attempts} status=${result.status} error=${result.error || '-'}`
    setLogs((current) => [text, ...current].slice(0, 20))
  }

  return <main style={{ maxWidth: 640, margin: '2rem auto', padding: '1rem' }}>
    <h1>Printer Test</h1>
    <p>Status: <strong>{status}</strong></p>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" onClick={connect}>Connect</button>
      <button type="button" onClick={printTest}>Cetak Struk Uji</button>
    </div>
    <pre aria-live="polite">{logs.join('\n')}</pre>
  </main>
}
