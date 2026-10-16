import { describe, expect, it } from 'vitest'
import { encodeRasterImage } from '../escpos'

describe('encodeRasterImage', () => {
  it('writes the GS v 0 header for a 48 dot wide, 96 dot tall bitmap', () => {
    const output = encodeRasterImage({ data: new Uint8Array(48 * 96), widthDots: 48, heightDots: 96 })

    expect(Array.from(output.slice(0, 8))).toEqual([0x1D, 0x76, 0x30, 0x00, 6, 0x00, 96, 0x00])
    expect(output.length).toBe(8 + 6 * 96)
  })

  it('packs dots MSB first, one byte per eight columns', () => {
    const data = new Uint8Array([1, 0, 1, 0, 0, 0, 0, 1])
    const output = encodeRasterImage({ data, widthDots: 8, heightDots: 1 })

    expect(Array.from(output.slice(8))).toEqual([0b10100001])
  })

  it('leaves trailing bits of a partial row clear', () => {
    const data = new Uint8Array(12).fill(1)
    const output = encodeRasterImage({ data, widthDots: 12, heightDots: 1 })

    expect(Array.from(output.slice(8))).toEqual([0xFF, 0b11110000])
  })

  it('produces an all-clear raster when no dot is set', () => {
    const output = encodeRasterImage({ data: new Uint8Array(16), widthDots: 16, heightDots: 2 })

    expect(Array.from(output.slice(8))).toEqual([0, 0, 0, 0])
  })
})
