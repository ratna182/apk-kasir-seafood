import type { PrinterConfig, PrinterStatus, IMinPrinterSDK, IMinPrintJobResult } from './types'

type StatusListener = (status: PrinterStatus) => void

/**
 * iMin D4-504 Built-in Printer SDK
 * 
 * This integrates with iMin's native Android printer service via WebView bridge.
 * The iMin D4-504 has a built-in thermal printer that requires:
 * - iMin Print SDK (AIDL service) for native Android
 * - WebView bridge for web-based applications
 * 
 * ESC/POS commands are sent through the bridge to the native printer service.
 */

// ESC/POS Commands for thermal printer
const ESCPOS = {
  INIT: new Uint8Array([0x1B, 0x40]), // Initialize printer
  FEED_LINE: new Uint8Array([0x0A]), // Feed line
  FEED_LINES: (n: number) => new Uint8Array([0x1B, 0x64, n]), // Feed n lines
  CUT_PAPER: new Uint8Array([0x1D, 0x56, 0x00]), // Full cut paper (no extra feed)
  SET_BOLD: new Uint8Array([0x1B, 0x45, 0x01]), // Bold on
  UNSET_BOLD: new Uint8Array([0x1B, 0x45, 0x00]), // Bold off
  SET_ALIGN_CENTER: new Uint8Array([0x1B, 0x61, 0x01]), // Center align
  SET_ALIGN_LEFT: new Uint8Array([0x1B, 0x61, 0x00]), // Left align
  SET_SIZE_NORMAL: new Uint8Array([0x1D, 0x21, 0x00]), // Normal size
  SET_SIZE_LARGE: new Uint8Array([0x1D, 0x21, 0x11]), // Double size
}

// Declare iMin bridge interface
declare global {
  interface Window {
    IMinPrinter?: {
      connect: () => Promise<boolean>
      disconnect: () => Promise<void>
      print: (base64Data: string) => Promise<boolean>
      printJob?: (jobId: string, base64Data: string) => Promise<string> | string
      getStatus: () => Promise<string>
      isSupported: () => boolean
    }
  }
}

class IMinPrinter implements IMinPrinterSDK {
  private connected = false
  private listeners: Set<StatusListener> = new Set()
  private currentStatus: PrinterStatus = 'idle'
  private lastError: string = ''

  get status(): PrinterStatus {
    return this.currentStatus
  }

  get error(): string {
    return this.lastError
  }

  private setStatus(status: PrinterStatus) {
    this.currentStatus = status
    this.listeners.forEach((fn) => fn(status))
  }

  private log(message: string, ...args: unknown[]) {
    console.log(`[IMinPrinter] ${message}`, ...args)
  }

  private logError(message: string, error?: unknown) {
    console.error(`[IMinPrinter] ${message}`, error)
    this.lastError = message
  }

  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  isSupported(): boolean {
    if (typeof window === 'undefined') return false
    return !!window.IMinPrinter
  }

  async connect(): Promise<boolean> {
    return this.connectWithTimeout(10000)
  }

  /**
   * Force reconnect - useful when printer was working then stopped
   * Call this from UI if print fails
   */
  async reconnect(): Promise<boolean> {
    this.log('Force reconnecting...')
    this.connected = false
    this.setStatus('idle')
    try {
      await window.IMinPrinter?.disconnect()
    } catch {}
    await new Promise(r => setTimeout(r, 500))
    return this.connectWithTimeout(15000)
  }

  private async connectWithTimeout(timeoutMs: number): Promise<boolean> {
    if (!this.isSupported()) {
      this.logError('iMin Printer SDK not supported')
      this.setStatus('unsupported')
      return false
    }

    try {
      this.setStatus('connecting')
      this.lastError = ''
      this.log('Connecting to iMin built-in printer...')

      const initResult = await window.IMinPrinter!.connect()
      
      const startTime = Date.now()
      while (Date.now() - startTime < timeoutMs) {
        await new Promise(r => setTimeout(r, 500))
        const status = await window.IMinPrinter!.getStatus()
        if (status === 'connected') {
          this.connected = true
          this.setStatus('connected')
          this.log('Connected to iMin built-in printer')
          return true
        }
        if (status === 'error') {
          break
        }
      }
      
      this.logError('Connection timeout or failed')
      this.setStatus('idle')
      return false
    } catch (e) {
      this.logError('Connection failed', e)
      this.setStatus('idle')
      return false
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.connected) {
        await window.IMinPrinter?.disconnect()
        this.connected = false
        this.setStatus('idle')
        this.log('Disconnected from iMin printer')
      }
    } catch (e) {
      this.logError('Disconnect failed', e)
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
    if (!this.connected) {
      this.logError('Printer not connected')
      return false
    }

    try {
      this.log(`Printing ${data.length} bytes...`)
      
      const result = await this.printJob(`legacy-${Date.now()}`, data)
      if (result.ok) {
        this.log('Print completed successfully')
        return true
      } else {
        this.logError('Print failed')
        return false
      }
    } catch (e) {
      this.logError('Print error', e)
      return false
    }
  }

  async printJob(jobId: string, data: Uint8Array): Promise<IMinPrintJobResult> {
    if (!this.connected) {
      return { ok: false, status: 'failed', error: 'Printer iMin belum terhubung', attempts: 0 }
    }

    try {
      let binary = ''
      for (let offset = 0; offset < data.length; offset += 8192) {
        binary += String.fromCharCode(...data.subarray(offset, offset + 8192))
      }
      const base64 = btoa(binary)
      const bridge = window.IMinPrinter
      if (!bridge) return { ok: false, status: 'failed', error: 'Bridge IMinPrinter tidak tersedia di APK', attempts: 0 }
      if (!bridge?.printJob) {
        const ok = await bridge?.print(base64)
        return { ok: !!ok, status: ok ? 'printed' : 'failed', error: ok ? null : 'Printer iMin gagal mencetak', attempts: 1 }
      }
      const raw = await bridge.printJob(jobId, base64)
      const result = JSON.parse(raw) as IMinPrintJobResult
      if (!result.ok) this.logError(result.error || `Print ${result.status}`)
      return result
    } catch (e) {
      this.logError('Print error', e)
      return { ok: false, status: 'failed', error: 'Bridge iMin tidak dapat memproses job', attempts: 0 }
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    if (!this.isSupported()) return 'unsupported'
    
    try {
      const status = await window.IMinPrinter!.getStatus()
      const mappedStatus: PrinterStatus = status === 'connected' ? 'connected' : 
                                          status === 'error' ? 'error' : 'idle'
      this.setStatus(mappedStatus)
      return mappedStatus
    } catch {
      return 'error'
    }
  }

  // Helper: Print raw ESC/POS data
  async printEscPos(commands: Uint8Array[]): Promise<boolean> {
    const combined = this.combineUint8Arrays(commands)
    return this.print(combined)
  }

  // Helper: Print text with formatting
  async printText(text: string, options: { bold?: boolean; align?: 'left' | 'center'; size?: 'normal' | 'large' } = {}): Promise<boolean> {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    // Init
    parts.push(ESCPOS.INIT)

    // Set formatting
    if (options.bold) parts.push(ESCPOS.SET_BOLD)
    if (options.align === 'center') parts.push(ESCPOS.SET_ALIGN_CENTER)
    else parts.push(ESCPOS.SET_ALIGN_LEFT)
    
    if (options.size === 'large') parts.push(ESCPOS.SET_SIZE_LARGE)
    else parts.push(ESCPOS.SET_SIZE_NORMAL)

    // Add text
    parts.push(encoder.encode(text))

    // Reset formatting
    if (options.bold) parts.push(ESCPOS.UNSET_BOLD)
    parts.push(ESCPOS.SET_ALIGN_LEFT)
    parts.push(ESCPOS.SET_SIZE_NORMAL)

    return this.printEscPos(parts)
  }

  // Helper: Cut paper
  async cutPaper(): Promise<boolean> {
    return this.printEscPos([ESCPOS.CUT_PAPER])
  }

  private combineUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
      result.set(arr, offset)
      offset += arr.length
    }
    return result
  }
}

export const iminPrinter = new IMinPrinter()
