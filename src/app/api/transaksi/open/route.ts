import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { getOpenShift } from '@/lib/kasir-shift'

export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }

    const nomorMeja = request.nextUrl.searchParams.get('nomorMeja')?.trim()
    const shift = await getOpenShift(prisma, warungId)
    if (!shift) {
      return NextResponse.json({ success: true, data: nomorMeja ? null : [] })
    }

    const transaksis = await prisma.transaksi.findMany({
      where: {
        warungId,
        shiftId: shift.id,
        status: 'OPEN',
        ...(nomorMeja ? { nomorMeja } : {}),
      },
      select: {
        id: true,
        nomorMeja: true,
        total: true,
        metodePembayaran: true,
        tanggal: true,
        createdAt: true,
        updatedAt: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, namaMenu: true, hargaSatuan: true, diskonSatuan: true, catatan: true, qty: true, subtotal: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json({ success: true, data: nomorMeja ? transaksis[0] ?? null : transaksis })
  } catch (error) {
    console.error('[GET /api/transaksi/open]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil meja aktif.' }, { status: 500 })
  }
}
