import type { PrinterConfig, PrinterStatus } from './types'
import type { BluetoothDevice, BluetoothRemoteGATTCharacteristic, BluetoothRemoteGATTService } from './bluetooth-types'
import { loadPrinterConfig, savePrinterConfig, clearPrinterConfig } from './storage'

type StatusListener = (status: PrinterStatus) => void

// Common service UUIDs for thermal printers (BLE)
const SERVICE_UUIDS = [
  '00001101-0000-1000-8000-00805f9b34fb', // SPP (Serial Port Profile)
  '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
  '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Common BLE service
  '0000fee7-0000-1000-8000-00805f9b34fb', // Another common service
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip Transparent UART
  '0000ae30-0000-1000-8000-00805f9b34fb', // Common thermal printer service
  '0000fff0-0000-1000-8000-00805f9b34fb', // Another common service
  '0000ff00-0000-1000-8000-00805f9b34fb', // Another common service
]

// Common characteristic UUIDs for writing data
const WRITE_CHARACTERISTIC_UUIDS = [
  '0000ffe1-0000-1000-8000-00805f9b34fb', // Common write characteristic
  '0000ffe2-0000-1000-8000-00805f9b34fb', // Another write characteristic
  '0000ae01-0000-1000-8000-00805f9b34fb', // Common thermal printer characteristic
  '49535343-1e4d-4bd9-ba61-23c647249616', // Microchip TX characteristic
  '49535343-88aa-4dd2-ab56-bff5f7403af7', // Microchip RX characteristic
  '0000fff1-0000-1000-8000-00805f9b34fb', // Another common characteristic
  '0000ff01-0000-1000-8000-00805f9b34fb', // Another common characteristic
]

class BluetoothPrinter {
  private device: BluetoothDevice | null = null
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null
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
    console.log(`[BluetoothPrinter] ${message}`, ...args)
  }

  private logError(message: string, error?: unknown) {
    console.error(`[BluetoothPrinter] ${message}`, error)
    this.lastError = message
  }

  onStatusChange(fn: StatusListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth
  }

  async connect(savedConfig?: PrinterConfig): Promise<boolean> {
    if (!this.isSupported()) {
      this.logError('Web Bluetooth not supported')
      this.setStatus('unsupported')
      return false
    }

    try {
      this.setStatus('connecting')
      this.lastError = ''
      this.log('Starting connection process...')

      let device: BluetoothDevice | null = null

      // Try to get already paired devices first (no popup)
      if (savedConfig?.deviceId) {
        this.log('Trying getDevices() for auto-reconnect...')
        try {
          const devices = await navigator.bluetooth!.getDevices()
          const savedDevice = devices.find((d) => d.id === savedConfig.deviceId)
          if (savedDevice) {
            this.log('Found saved device, connecting directly...')
            device = savedDevice
          }
        } catch (e) {
          this.log('getDevices() failed:', e)
        }
      }

      // If no device found, show device picker
      if (!device) {
        this.log('Opening device picker...')
        if (savedConfig?.deviceId) {
          try {
            device = await navigator.bluetooth!.requestDevice({
              filters: [{ deviceId: savedConfig.deviceId }],
              optionalServices: SERVICE_UUIDS,
            })
          } catch (e) {
            this.log('Filter failed, showing all devices')
            device = await navigator.bluetooth!.requestDevice({
              acceptAllDevices: true,
              optionalServices: SERVICE_UUIDS,
            })
          }
        } else {
          device = await navigator.bluetooth!.requestDevice({
            acceptAllDevices: true,
            optionalServices: SERVICE_UUIDS,
          })
        }
      }

      this.log('Device selected:', device.name || device.id)

      device.addEventListener('gattserverdisconnected', () => {
        this.log('Device disconnected')
        this.device = null
        this.characteristic = null
        this.setStatus('idle')
      })

      this.log('Connecting to GATT server...')
      const server = await device.gatt!.connect()
      this.log('GATT server connected')

      // Try to find the correct service
      let service: BluetoothRemoteGATTService | null = null
      let serviceFound = false

      for (const uuid of SERVICE_UUIDS) {
        try {
          this.log(`Trying service UUID: ${uuid}`)
          service = await server.getPrimaryService(uuid)
          this.log(`Service found: ${uuid}`)
          serviceFound = true
          break
        } catch (e) {
          this.log(`Service ${uuid} not found, trying next...`)
        }
      }

      if (!serviceFound) {
        this.log('No known service found, trying to get all services...')
        try {
          const services = await server.getPrimaryServices()
          this.log(`Found ${services.length} services`)
          if (services.length > 0) {
            service = services[0]
            this.log('Using first available service')
          }
        } catch (e) {
          this.logError('Failed to get services', e)
        }
      }

      if (!service) {
        this.logError('No service found on device')
        this.setStatus('idle')
        return false
      }

      // Try to find the correct characteristic
      let characteristic: BluetoothRemoteGATTCharacteristic | null = null
      let characteristicFound = false

      // First try known characteristic UUIDs
      for (const uuid of WRITE_CHARACTERISTIC_UUIDS) {
        try {
          this.log(`Trying characteristic UUID: ${uuid}`)
          characteristic = await service.getCharacteristic(uuid)
          this.log(`Characteristic found: ${uuid}`)
          characteristicFound = true
          break
        } catch (e) {
          this.log(`Characteristic ${uuid} not found, trying next...`)
        }
      }

      // If no known characteristic found, try to find any writable characteristic
      if (!characteristicFound) {
        this.log('No known characteristic found, scanning all characteristics...')
        try {
          const chars = await service.getCharacteristics()
          this.log(`Found ${chars.length} characteristics`)
          
          // Look for writable characteristics
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              characteristic = char
              this.log('Found writable characteristic:', char.uuid)
              characteristicFound = true
              break
            }
          }

          // If no writable characteristic found, use the first one
          if (!characteristicFound && chars.length > 0) {
            characteristic = chars[0]
            this.log('Using first available characteristic:', chars[0].uuid)
          }
        } catch (e) {
          this.logError('Failed to get characteristics', e)
        }
      }

      if (!characteristic) {
        this.logError('No characteristic found on service')
        this.setStatus('idle')
        return false
      }

      // Try to enable notifications if supported
      try {
        if (characteristic.properties.notify) {
          this.log('Enabling notifications...')
          await characteristic.startNotifications()
          this.log('Notifications enabled')
          
          // Add event listener for notifications
          characteristic.addEventListener('characteristicvaluechanged', (event) => {
            this.log('Notification received:', event)
          })
        }
      } catch (e) {
        this.log('Failed to enable notifications, continuing...')
      }

      this.device = device
      this.characteristic = characteristic

      const config: PrinterConfig = {
        deviceId: device.id,
        deviceName: device.name || 'Printer Bluetooth',
        width: savedConfig?.width || '58mm',
        connectionType: 'bluetooth',
      }
      savePrinterConfig(config)

      this.log('Connection successful')
      this.setStatus('connected')
      return true
    } catch (e) {
      this.logError('Connection failed', e)
      this.setStatus('idle')
      return false
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect()
      }
    } catch (e) {
      this.logError('Error during disconnect', e)
    }
    this.device = null
    this.characteristic = null
    this.setStatus('idle')
    clearPrinterConfig()
  }

  async write(data: Uint8Array): Promise<boolean> {
    if (!this.characteristic) {
      this.logError('No characteristic available for writing')
      return false
    }

    try {
      // Use very small chunk size for better compatibility with thermal printers
      const CHUNK_SIZE = 20
      const totalChunks = Math.ceil(data.length / CHUNK_SIZE)
      
      this.log(`Writing ${data.length} bytes in ${totalChunks} chunks`)
      
      // Check characteristic properties
      const canWriteWithResponse = this.characteristic.properties.write
      const canWriteWithoutResponse = this.characteristic.properties.writeWithoutResponse
      
      this.log(`Write properties - WithResponse: ${canWriteWithResponse}, WithoutResponse: ${canWriteWithoutResponse}`)
      
      // Send wake-up signal to printer
      this.log('Sending wake-up signal...')
      try {
        const wakeUp = new Uint8Array([0x00])
        if (canWriteWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(wakeUp)
        } else if (canWriteWithResponse) {
          await this.characteristic.writeValueWithResponse(wakeUp)
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (e) {
        this.log('Wake-up signal failed, continuing...')
      }
      
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE)
        const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1
        let writeSuccess = false
        
        // Try writeWithoutResponse first (more common for thermal printers)
        if (canWriteWithoutResponse) {
          try {
            await this.characteristic.writeValueWithoutResponse(chunk)
            this.log(`Chunk ${chunkNumber}/${totalChunks} written without response`)
            writeSuccess = true
          } catch (e) {
            this.log(`Chunk ${chunkNumber}/${totalChunks} writeWithoutResponse failed`)
          }
        }
        
        // Try writeWithResponse if writeWithoutResponse failed or not supported
        if (!writeSuccess && canWriteWithResponse) {
          try {
            await this.characteristic.writeValueWithResponse(chunk)
            this.log(`Chunk ${chunkNumber}/${totalChunks} written with response`)
            writeSuccess = true
          } catch (e) {
            this.log(`Chunk ${chunkNumber}/${totalChunks} writeWithResponse failed`)
          }
        }
        
        // If both methods failed
        if (!writeSuccess) {
          this.logError(`Failed to write chunk ${chunkNumber}/${totalChunks}`)
          return false
        }
        
        // Delay between chunks - increase for stability
        if (i + CHUNK_SIZE < data.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      this.log('All data written successfully')
      return true
    } catch (e) {
      this.logError('Write failed', e)
      return false
    }
  }

  async autoReconnect(): Promise<boolean> {
    const saved = loadPrinterConfig()
    if (!saved) {
      this.log('No saved printer config found')
      return false
    }
    this.log('Attempting auto-reconnect to:', saved.deviceName)
    return this.connect(saved)
  }
}

export const printer = new BluetoothPrinter()
