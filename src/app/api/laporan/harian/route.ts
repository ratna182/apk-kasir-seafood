import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, isOwner, requireWarungAccess } from '@/lib/auth'
import { buildLaporanHarian } from '@/lib/laporan-shift'
import { getStoreDateKey } from '@/lib/time'

// GET /api/laporan/harian — rekap penjualan per shift yang dibuka pada tanggal WIB tertentu.
// Query params: warung_id (required untuk owner), tanggal (YYYY-MM-DD, default hari ini WIB)
export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)

    const { searchParams } = new URL(request.url)
    const warungIdParam = searchParams.get('warung_id')

    let warungId: string

    if (context) {
      if (isOwner(context)) {
        if (!warungIdParam) {
          return NextResponse.json({ success: false, message: 'warung_id wajib diisi untuk owner.' }, { status: 400 })
        }
        const warungAccessError = requireWarungAccess(context, warungIdParam)
        if (warungAccessError) return warungAccessError
        warungId = warungIdParam
      } else {
        warungId = context.warungId ?? ''
        if (!warungId) {
          return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
        }
      }
    } else {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    const dateKey = searchParams.get('tanggal')?.trim() || getStoreDateKey()
    const data = await buildLaporanHarian(prisma, warungId, dateKey)

    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Format tanggal')) {
      return NextResponse.json({ success: false, message: error.message }, { status: 422 })
    }
    console.error('[GET /api/laporan/harian]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil laporan.' }, { status: 500 })
  }
}
