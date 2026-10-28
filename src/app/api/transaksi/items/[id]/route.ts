import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { getOpenShift } from '@/lib/kasir-shift'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }
    const { id } = await params
    const body = await request.json()
    const qty = Number(body.qty)

    if (!Number.isInteger(qty) || qty < 1) {
      return NextResponse.json({ success: false, message: 'Qty harus minimal 1.' }, { status: 422 })
    }

    const transaksi = await prisma.$transaction(async (tx) => {
      const shift = await getOpenShift(tx, warungId)
      if (!shift) return 'CLOSED'

      const item = await tx.transaksiItem.findFirst({
        where: { id, transaksi: { warungId, shiftId: shift.id, status: 'OPEN' } },
      })

      if (!item) return null

      await tx.transaksiItem.update({
        where: { id },
        data: { qty, subtotal: (item.hargaSatuan - item.diskonSatuan) * qty },
      })

      const total = await tx.transaksiItem.aggregate({
        where: { transaksiId: item.transaksiId },
        _sum: { subtotal: true },
      })

      return tx.transaksi.update({
        where: { id: item.transaksiId },
        data: { total: total._sum.subtotal || 0 },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      })
    })

    if (!transaksi) {
      return NextResponse.json({ success: false, message: 'Item order aktif tidak ditemukan.' }, { status: 404 })
    }

    if (transaksi === 'CLOSED') {
      return NextResponse.json({ success: false, message: 'Kasir sudah ditutup.' }, { status: 409 })
    }

    return NextResponse.json({ success: true, data: transaksi })
  } catch (error) {
    console.error('[PATCH /api/transaksi/items/[id]]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengubah item order.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = getAuthContext(request)
    const authError = await requireKasirAccess(context)
    if (authError) return authError

    const warungId = await getKasirWarungId(context)
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Kasir tidak terdaftar di warung.' }, { status: 403 })
    }
    const { id } = await params
    const transaksi = await prisma.$transaction(async (tx) => {
      const shift = await getOpenShift(tx, warungId)
      if (!shift) return 'CLOSED'

      const item = await tx.transaksiItem.findFirst({
        where: { id, transaksi: { warungId, shiftId: shift.id, status: 'OPEN' } },
      })

      if (!item) return null

      await tx.transaksiItem.delete({ where: { id } })

      const total = await tx.transaksiItem.aggregate({
        where: { transaksiId: item.transaksiId },
        _sum: { subtotal: true },
      })

      return tx.transaksi.update({
        where: { id: item.transaksiId },
        data: { total: total._sum.subtotal || 0 },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      })
    })

    if (!transaksi) {
      return NextResponse.json({ success: false, message: 'Item order aktif tidak ditemukan.' }, { status: 404 })
    }

    if (transaksi === 'CLOSED') {
      return NextResponse.json({ success: false, message: 'Kasir sudah ditutup.' }, { status: 409 })
    }

    return NextResponse.json({ success: true, data: transaksi })
  } catch (error) {
    console.error('[DELETE /api/transaksi/items/[id]]', error)
    return NextResponse.json({ success: false, message: 'Gagal menghapus item order.' }, { status: 500 })
  }
}
