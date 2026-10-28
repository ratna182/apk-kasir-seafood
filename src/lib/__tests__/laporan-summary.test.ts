import { describe, it, expect } from 'vitest'
import { resolveLaporanSummary, type LaporanSummarySource } from '../laporan-summary'

const data: LaporanSummarySource = {
  jumlahTransaksi: 2,
  grandTotalQty: 11,
  grandTotalPendapatan: 211000,
  totalCash: 67000,
  totalQRIS: 144000,
  totalTransfer: 0,
  shifts: [
    {
      id: 'shift1',
      dibukaPada: '2026-10-28T01:00:00.000Z',
      totalTransaksi: 2,
      jumlahItem: 11,
      totalPendapatan: 211000,
      totalCash: 67000,
      totalQRIS: 144000,
      totalTransfer: 0,
    },
    {
      id: 'shift2',
      dibukaPada: '2026-10-28T15:21:00.000Z',
      totalTransaksi: 0,
      jumlahItem: 0,
      totalPendapatan: 0,
      totalCash: 0,
      totalQRIS: 0,
      totalTransfer: 0,
    },
  ],
}

describe('resolveLaporanSummary', () => {
  it('returns null when the report has not loaded', () => {
    expect(resolveLaporanSummary(null, null, '2026-10-28')).toBeNull()
  })

  it('uses the active shift totals so a new shift starts at zero', () => {
    const summary = resolveLaporanSummary(
      data,
      { id: 'shift2', dibukaPada: '2026-10-28T15:21:00.000Z' },
      '2026-10-28',
    )

    expect(summary).toEqual({
      scope: 'SHIFT',
      jumlahTransaksi: 0,
      grandTotalQty: 0,
      grandTotalPendapatan: 0,
      totalCash: 0,
      totalQRIS: 0,
      totalTransfer: 0,
    })
  })

  it('uses the open shift totals when that shift belongs to the selected date', () => {
    const summary = resolveLaporanSummary(
      data,
      { id: 'shift1', dibukaPada: '2026-10-28T01:00:00.000Z' },
      '2026-10-28',
    )

    expect(summary).toMatchObject({
      scope: 'SHIFT',
      jumlahTransaksi: 2,
      grandTotalQty: 11,
      grandTotalPendapatan: 211000,
      totalCash: 67000,
      totalQRIS: 144000,
    })
  })

  it('falls back to daily totals when viewing another date', () => {
    const summary = resolveLaporanSummary(
      data,
      { id: 'shift2', dibukaPada: '2026-10-28T15:21:00.000Z' },
      '2026-10-27',
    )

    expect(summary).toMatchObject({
      scope: 'HARIAN',
      jumlahTransaksi: 2,
      grandTotalQty: 11,
      grandTotalPendapatan: 211000,
    })
  })

  it('falls back to daily totals when the cashier is closed', () => {
    expect(resolveLaporanSummary(data, null, '2026-10-28')).toMatchObject({ scope: 'HARIAN' })
  })

  it('falls back to daily totals when the open shift date is invalid', () => {
    const summary = resolveLaporanSummary(data, { id: 'shift1', dibukaPada: 'invalid' }, '2026-10-28')

    expect(summary).toMatchObject({ scope: 'HARIAN' })
  })
})
