import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { getKasirSessionState, personName } from '@/lib/kasir-shift'
import { getStoreDateKey } from '@/lib/time'

export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    if (!context) return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })

    let warungId: string | null = null
    if (requireRole(context, 'OWNER') === null) {
      warungId = new URL(request.url).searchParams.get('warungId')
      if (!warungId) {
        return NextResponse.json({ success: false, message: 'warungId wajib diisi.' }, { status: 400 })
      }
    } else if (requireRole(context, 'KASIR') === null) {
      warungId = context.warungId ?? null
      if (!warungId) {
        return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
      }
    } else {
      return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
    }

    const state = await getKasirSessionState(prisma, warungId)
    const shift = state.shift
    const latest = state.latest

    return NextResponse.json({
      success: true,
      data: {
        hariIni: getStoreDateKey(),
        sudahTutup: state.isClosed,
        shift: shift ? {
          id: shift.id,
          dibukaPada: shift.dibukaPada?.toISOString() ?? null,
          ditutupPada: shift.ditutupPada?.toISOString() ?? null,
          dibukaOleh: personName(shift.pembuka),
          ditutupOleh: shift.penutup ? personName(shift.penutup) : null,
          totalTransaksi: shift.totalTransaksi,
          totalPendapatan: shift.totalPendapatan,
          durationHours: state.durationHours,
          overtime: state.overtime,
        } : null,
        latestShift: latest ? {
          id: latest.id,
          status: latest.status,
          dibukaPada: latest.dibukaPada?.toISOString() ?? null,
          ditutupPada: latest.ditutupPada?.toISOString() ?? null,
          dibukaOleh: personName(latest.pembuka),
          ditutupOleh: latest.penutup ? personName(latest.penutup) : null,
          totalTransaksi: latest.totalTransaksi,
          totalPendapatan: latest.totalPendapatan,
        } : null,
        dibukaPada: shift?.dibukaPada?.toISOString() ?? latest?.dibukaPada?.toISOString() ?? null,
        ditutupPada: state.isClosed ? latest?.ditutupPada?.toISOString() ?? null : null,
        dibukaOleh: shift ? personName(shift.pembuka) : latest ? personName(latest.pembuka) : null,
        ditutupOleh: !shift && latest?.penutup ? personName(latest.penutup) : null,
        totalTransaksi: latest?.totalTransaksi ?? 0,
        totalPendapatan: latest?.totalPendapatan ?? 0,
        durationHours: state.durationHours,
        overtime: state.overtime,
        warningHours: state.warningHours,
      },
    })
  } catch (error) {
    console.error('[GET /api/kasir/status]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil status kasir.' }, { status: 500 })
  }
}
