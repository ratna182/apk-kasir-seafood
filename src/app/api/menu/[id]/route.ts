import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, isOwner, requireRole, requireWarungAccess } from '@/lib/auth'
import { syncMenusAcrossWarungs } from '@/lib/menu-sync'
import { isRupiahAmount } from '@/lib/rupiah'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { nama, categoryId, harga, isAktif, sortOrder } = body

    const menu = await prisma.menu.findFirst({ where: { id } })
    if (!menu) {
      return NextResponse.json({ success: false, message: 'Menu tidak ditemukan.' }, { status: 404 })
    }

    const warungAccessError = requireWarungAccess(context, menu.warungId)
    if (warungAccessError) return warungAccessError

    const errors: Record<string, string> = {}
    if (nama !== undefined && !nama.trim()) errors.nama = 'Nama menu tidak boleh kosong.'
    if (categoryId !== undefined) {
      const cat = await prisma.menuCategory.findFirst({ where: { id: categoryId, warungId: menu.warungId } })
      if (!cat) errors.categoryId = 'Kategori tidak valid.'
    }
    if (harga !== undefined && !isRupiahAmount(harga)) errors.harga = 'Harga harus angka bulat positif.'

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 422 })
    }

    if (nama && nama.trim() !== menu.nama) {
      const existing = await prisma.menu.findFirst({
        where: { nama: nama.trim(), warungId: menu.warungId, id: { not: id } },
      })
      if (existing) {
        return NextResponse.json({ success: false, errors: { nama: 'Nama menu sudah ada.' } }, { status: 422 })
      }
    }

    const updated = await prisma.menu.update({
      where: { id },
      data: {
        ...(nama !== undefined && { nama: nama.trim() }),
        ...(categoryId !== undefined && { categoryId }),
        ...(harga !== undefined && { harga: harga }),
        ...(isAktif !== undefined && { isAktif: Boolean(isAktif) }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
      },
    })

    await syncMenusAcrossWarungs()

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('[PUT /api/menu/:id]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengupdate menu.' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const { id } = await params

    const menu = await prisma.menu.findFirst({ where: { id } })
    if (!menu) {
      return NextResponse.json({ success: false, message: 'Menu tidak ditemukan.' }, { status: 404 })
    }

    const warungAccessError = requireWarungAccess(context, menu.warungId)
    if (warungAccessError) return warungAccessError

    await prisma.transaksiItem.deleteMany({ where: { menuId: id } })
    await prisma.menu.delete({ where: { id } })

    await syncMenusAcrossWarungs()

    return NextResponse.json({ success: true, message: 'Menu berhasil dihapus.' })
  } catch (error) {
    console.error('[DELETE /api/menu/:id]', error)
    return NextResponse.json({ success: false, message: 'Gagal menghapus menu.' }, { status: 500 })
  }
}
