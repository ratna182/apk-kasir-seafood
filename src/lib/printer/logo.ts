import { encodeRasterImage, type BitmapImage } from './escpos'

const LOGO_URL = '/logo-baru.webp'
const MAX_WIDTH_DOTS = 128
const MAX_HEIGHT_DOTS = 128
const INK_THRESHOLD = 160
const LOAD_TIMEOUT_MS = 3000

const cache = new Map<number, Promise<Uint8Array | null>>()

export function clearReceiptLogoCache(): void {
  cache.clear()
}

/**
 * Raster of the receipt logo as GS v 0 bytes, cached per paper width.
 * Returns null when the image or canvas is unavailable so printing still works.
 */
export function loadReceiptLogo(columns: number): Promise<Uint8Array | null> {
  const cached = cache.get(columns)
  if (cached) return cached
  const pending = rasterize(columns).catch(() => null)
  cache.set(columns, pending)
  return pending
}

async function rasterize(columns: number): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null
  const image = await loadImage(LOGO_URL)
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  if (!naturalWidth || !naturalHeight) return null

  const fit = fitSize(naturalWidth, naturalHeight, Math.min(columns * 8, MAX_WIDTH_DOTS), MAX_HEIGHT_DOTS)
  const canvas = document.createElement('canvas')
  canvas.width = fit.widthDots
  canvas.height = fit.heightDots
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, fit.widthDots, fit.heightDots)

  const pixels = context.getImageData(0, 0, fit.widthDots, fit.heightDots).data
  const bitmap: BitmapImage = {
    data: new Uint8Array(fit.widthDots * fit.heightDots),
    widthDots: fit.widthDots,
    heightDots: fit.heightDots,
  }
  for (let dot = 0; dot < bitmap.data.length; dot++) {
    const offset = dot * 4
    if (pixels[offset + 3] < 32) continue
    const luma = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]
    bitmap.data[dot] = luma < INK_THRESHOLD ? 1 : 0
  }
  return encodeRasterImage(bitmap)
}

function fitSize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidthDots: number,
  maxHeightDots: number,
): { widthDots: number; heightDots: number } {
  const scale = Math.min(maxWidthDots / naturalWidth, maxHeightDots / naturalHeight, 1)
  return {
    widthDots: Math.max(1, Math.round(naturalWidth * scale)),
    heightDots: Math.max(1, Math.round(naturalHeight * scale)),
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // A stalled load must never hold up printing, so it is bounded like the socket timeouts.
    const timer = setTimeout(() => reject(new Error('logo struk tidak merespons')), LOAD_TIMEOUT_MS)
    const settle = (finish: () => void) => {
      clearTimeout(timer)
      finish()
    }
    image.onload = () => settle(() => resolve(image))
    image.onerror = () => settle(() => reject(new Error('logo struk gagal dimuat')))
    image.src = url
  })
}
