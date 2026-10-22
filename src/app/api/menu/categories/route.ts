import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import { getMasterWarungId } from '@/lib/menu-sync'

export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const warungId = await getMasterWarungId()
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Warung tidak ditemukan.' }, { status: 404 })
    }

    const categories = await prisma.menuCategory.findMany({
      where: { warungId },
      include: { _count: { select: { menus: true } } },
      orderBy: { nama: 'asc' },
    })

    return NextResponse.json({ success: true, data: categories })
  } catch (error) {
    console.error('[GET /api/menu/categories]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil data kategori.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const warungId = await getMasterWarungId()
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Warung tidak ditemukan.' }, { status: 404 })
    }

    const body = await request.json()
    const { nama, sortOrder } = body

    if (!nama || !nama.trim()) {
      return NextResponse.json({ success: false, errors: { nama: 'Nama kategori wajib diisi.' } }, { status: 422 })
    }

    const existing = await prisma.menuCategory.findFirst({
      where: { warungId, nama: nama.trim() },
    })
    if (existing) {
      return NextResponse.json({ success: false, errors: { nama: 'Nama kategori sudah ada.' } }, { status: 422 })
    }

    const category = await prisma.menuCategory.create({
      data: {
        warungId,
        nama: nama.trim(),
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      },
    })

    return NextResponse.json({ success: true, data: category }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/menu/categories]', error)
    return NextResponse.json({ success: false, message: 'Gagal menyimpan kategori.' }, { status: 500 })
  }
}
