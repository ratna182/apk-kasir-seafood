import type { PrinterConfig, PrinterStatus, PrinterConnectionType } from './types'
import { printer as bluetoothPrinter } from './bluetooth'
import { iminPrinter } from './imin-sdk'
import { loadPrinterConfig, savePrinterConfig, clearPrinterConfig } from './storage'

type StatusListener = (status: PrinterStatus) => void

/**
 * Unified Printer Manager
 * 
 * Supports both:
 * - Bluetooth printers (legacy, external)
 * - iMin D4 505 built-in printer (via SDK)
 * 
 * Automatically detects and uses the appropriate printer based on config.
 */

class UnifiedPrinter {
  private activePrinter: 'bluetooth' | 'imin' | null = null
  private listeners: Set<StatusListener> = new Set()
  private currentStatus: PrinterStatus = 'idle'
  private lastError: string = ''
  private printQueue: Promise<boolean> = Promise.resolve(true)

  get status(): PrinterStatus {
    return this.currentStatus
  }

  get error(): string {
    return this.lastError
  }

  get connectionType(): PrinterConnectionType | null {
    return this.activePrinter
  }

  private setStatus(status: PrinterStatus) {
    this.currentStatus = status
    this.listeners.forEach((fn) => fn(status))
  }

  private log(message: string, ...args: unknown[]) {
    console.log(`[UnifiedPrinter] ${message}`, ...args)
  }

  private logError(message: string, error?: unknown) {
    console.error(`[UnifiedPrinter] ${message}`, error)
    this.lastError = message
  }

  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn)
    
    // Also subscribe to active printer's status changes
    const unsubBluetooth = bluetoothPrinter.onStatusChange(fn)
    const unsubImin = iminPrinter.onStatusChange(fn)
    
    return () => {
      this.listeners.delete(fn)
      unsubBluetooth()
      unsubImin()
    }
  }

  /**
   * Check available printer connections
   */
  getAvailablePrinters(): { bluetooth: boolean; imin: boolean } {
    return {
      bluetooth: bluetoothPrinter.isSupported(),
      imin: iminPrinter.isSupported(),
    }
  }

  /**
   * Connect to printer based on saved config or auto-detect
   */
  async connect(savedConfig?: PrinterConfig): Promise<boolean> {
    const config = savedConfig || loadPrinterConfig()
    
    // If we have a saved config, use that connection type
    if (config) {
      if (config.connectionType === 'imin') {
        return this.connectImin()
      }
      return this.connectBluetooth(savedConfig)
    }

    // Auto-detect: prefer iMin if available (built-in printer)
    const available = this.getAvailablePrinters()
    
    if (available.imin) {
      this.log('iMin printer available, connecting to built-in printer...')
      return this.connectImin()
    }
    
    if (available.bluetooth) {
      this.log('Bluetooth printer available, connecting...')
      return this.connectBluetooth()
    }

    this.logError('No printers available')
    this.setStatus('unsupported')
    return false
  }

  /**
   * Connect to iMin built-in printer
   */
  async connectImin(): Promise<boolean> {
    this.log('Connecting to iMin built-in printer...')
    this.activePrinter = 'imin'
    
    const result = await iminPrinter.connect()
    if (result) {
      const config: PrinterConfig = {
        deviceId: 'imin-built-in',
        deviceName: 'iMin D4-504 Built-in Printer',
        width: '80mm',
        connectionType: 'imin',
      }
      savePrinterConfig(config)
      this.setStatus('connected')
      return true
    }
    
    this.setStatus('idle')
    return false
  }

  /**
   * Connect to Bluetooth printer
   */
  async connectBluetooth(savedConfig?: PrinterConfig): Promise<boolean> {
    this.log('Connecting to Bluetooth printer...')
    this.activePrinter = 'bluetooth'
    
    const result = await bluetoothPrinter.connect(savedConfig)
    if (result) {
      this.setStatus('connected')
      return true
    }
    
    this.setStatus('idle')
    return false
  }

  /**
   * Disconnect from current printer
   */
  async disconnect(): Promise<void> {
    if (this.activePrinter === 'imin') {
      await iminPrinter.disconnect()
    } else if (this.activePrinter === 'bluetooth') {
      await bluetoothPrinter.disconnect()
    }
    
    this.activePrinter = null
    this.setStatus('idle')
    clearPrinterConfig()
  }

  /**
   * Auto-reconnect to saved printer
   */
  async autoReconnect(): Promise<boolean> {
    const saved = loadPrinterConfig()
    if (!saved) {
      this.log('No saved printer config found')
      return false
    }
    
    this.log('Attempting auto-reconnect to:', saved.deviceName)
    return this.connect(saved)
  }

  /**
   * Force reconnect current printer (call when print fails)
   */
  async forceReconnect(): Promise<boolean> {
    if (this.activePrinter === 'imin') {
      this.log('Force reconnecting iMin printer...')
      return iminPrinter.reconnect()
    }
    if (this.activePrinter === 'bluetooth') {
      this.log('Force reconnecting Bluetooth printer...')
      await bluetoothPrinter.disconnect()
      return this.connectBluetooth()
    }
    return false
  }

  /**
   * Print data using active printer
   */
  async print(data: Uint8Array): Promise<boolean> {
    const job = this.printQueue.then(() => this.printNow(data))
    this.printQueue = job.catch(() => false)
    return job
  }

  private async printNow(data: Uint8Array): Promise<boolean> {
    // The page can reload while the saved printer config remains available.
    // Reconnect here instead of relying on a background effect finishing first.
    if (!this.activePrinter) {
      const saved = loadPrinterConfig()
      if (!saved || !(await this.connect(saved))) {
        this.logError('No printer connected')
        return false
      }
    }

    if (this.activePrinter === 'imin' && iminPrinter.status !== 'connected') {
      if (!(await this.connectImin())) return false
    }

    if (!this.activePrinter) {
      this.logError('No printer connected')
      return false
    }

    if (this.activePrinter === 'imin') {
      return iminPrinter.print(data)
    }
    
    return bluetoothPrinter.write(data)
  }

  /**
   * Print receipt using ESC/POS commands
   */
  async printReceipt(receiptData: {
    title?: string
    items: Array<{ name: string; qty: number; price: number }>
    total: number
    payment?: string
    footer?: string
  }): Promise<boolean> {
    const encoder = new TextEncoder()
    const commands: Uint8Array[] = []
    
    // Initialize
    commands.push(new Uint8Array([0x1B, 0x40])) // INIT
    
    // Title
    if (receiptData.title) {
      commands.push(new Uint8Array([0x1B, 0x61, 0x01])) // Center align
      commands.push(new Uint8Array([0x1B, 0x45, 0x01])) // Bold on
      commands.push(new Uint8Array([0x1D, 0x21, 0x11])) // Double size
      commands.push(encoder.encode(receiptData.title))
      commands.push(new Uint8Array([0x1D, 0x21, 0x00])) // Normal size
      commands.push(new Uint8Array([0x1B, 0x45, 0x00])) // Bold off
      commands.push(new Uint8Array([0x0A])) // Feed line
    }
    
    // Items
    commands.push(new Uint8Array([0x1B, 0x61, 0x00])) // Left align
    for (const item of receiptData.items) {
      const line = `${item.name} x${item.qty} @Rp${item.price.toLocaleString('id-ID')}`
      commands.push(encoder.encode(line))
      commands.push(new Uint8Array([0x0A]))
    }
    
    // Separator
    commands.push(encoder.encode('─'.repeat(32)))
    commands.push(new Uint8Array([0x0A]))
    
    // Total
    commands.push(new Uint8Array([0x1B, 0x45, 0x01])) // Bold on
    commands.push(encoder.encode(`TOTAL: Rp${receiptData.total.toLocaleString('id-ID')}`))
    commands.push(new Uint8Array([0x1B, 0x45, 0x00])) // Bold off
    commands.push(new Uint8Array([0x0A]))
    
    // Payment
    if (receiptData.payment) {
      commands.push(encoder.encode(`Bayar: ${receiptData.payment}`))
      commands.push(new Uint8Array([0x0A]))
    }
    
    // Footer
    if (receiptData.footer) {
      commands.push(new Uint8Array([0x1B, 0x61, 0x01])) // Center align
      commands.push(new Uint8Array([0x0A]))
      commands.push(encoder.encode(receiptData.footer))
      commands.push(new Uint8Array([0x0A]))
    }
    
    // Cut immediately after the final line to avoid a large blank margin.
    commands.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00])) // Cut paper
    
    // Combine all commands
    const totalLength = commands.reduce((acc, cmd) => acc + cmd.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const cmd of commands) {
      combined.set(cmd, offset)
      offset += cmd.length
    }
    
    return this.print(combined)
  }
}

export const printer = new UnifiedPrinter()
