import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { getKasirSessionState } from '@/lib/kasir-session'

export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)

    let warungId: string | null = null

    if (context) {
      if (requireRole(context, 'OWNER') === null) {
        const { searchParams } = new URL(request.url)
        warungId = searchParams.get('warungId')
        if (!warungId) {
          return NextResponse.json({ success: false, message: 'warungId wajib diisi.' }, { status: 400 })
        }
      } else if (requireRole(context, 'KASIR') === null) {
        warungId = context?.warungId ?? null
        if (!warungId) {
          return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
        }
      } else {
        return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
      }
    } else return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })

    const state = await getKasirSessionState(prisma, warungId!, context!.user.id)
    const sesi = state.latest

    return NextResponse.json({
      success: true,
      data: {
        hariIni: state.today.toISOString().split('T')[0],
        sudahTutup: state.isClosed,
        dibukaPada: state.latest?.dibukaPada ?? state.latest?.dibukaKembaliPada ?? null,
        ditutupPada: state.isClosed ? sesi?.ditutupPada : null,
        totalTransaksi: state.isClosed ? sesi?.totalTransaksi || 0 : 0,
        totalPendapatan: state.isClosed ? sesi?.totalPendapatan || 0 : 0,
      },
    })
  } catch (error) {
    console.error('[GET /api/kasir/status]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil status kasir.' }, { status: 500 })
  }
}
