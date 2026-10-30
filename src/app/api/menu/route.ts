import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, isOwner, requireRole, requireWarungAccess } from '@/lib/auth'
import { getMasterWarungId, syncMenusAcrossWarungs } from '@/lib/menu-sync'
import { isRupiahAmount } from '@/lib/rupiah'

export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const warungId = searchParams.get('warung_id')

    const where: { warungId?: string } = {}
    if (isOwner(context)) {
      where.warungId = warungId || await getMasterWarungId() || undefined
    } else {
      where.warungId = context?.warungId ?? undefined
    }

    const menus = await prisma.menu.findMany({
      where,
      include: {
        category: { select: { id: true, nama: true } },
        warungMenus: { select: { harga: true, warungId: true } },
      },
      orderBy: [{ category: { nama: 'asc' } }, { nama: 'asc' }],
    })

    const menusWithHarga = menus.map((menu) => {
      const override = menu.warungMenus.find((wm) => wm.warungId === where.warungId)
      return {
        ...menu,
        harga: override?.harga ?? menu.harga,
        hargaDefault: menu.harga,
        isCustomHarga: !!override,
      }
    })

    return NextResponse.json({ success: true, data: menusWithHarga })
  } catch (error) {
    console.error('[GET /api/menu]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil data menu.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)

    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const body = await request.json()
    const { nama, categoryId, harga, sortOrder } = body
    const warungId = await getMasterWarungId()
    if (!warungId) {
      return NextResponse.json({ success: false, message: 'Warung master tidak ditemukan.' }, { status: 404 })
    }

    if (!nama || !nama.trim()) {
      return NextResponse.json({ success: false, errors: { nama: 'Nama menu wajib diisi.' } }, { status: 422 })
    }
    if (!categoryId) {
      return NextResponse.json({ success: false, errors: { categoryId: 'Kategori wajib dipilih.' } }, { status: 422 })
    }
    if (!isRupiahAmount(harga)) {
      return NextResponse.json({ success: false, errors: { harga: 'Harga harus angka bulat positif.' } }, { status: 422 })
    }

    const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, warungId } })
    if (!category) {
      return NextResponse.json({ success: false, errors: { categoryId: 'Kategori tidak valid.' } }, { status: 422 })
    }

    const existing = await prisma.menu.findFirst({ where: { nama: nama.trim() } })
    if (existing) {
      return NextResponse.json({ success: false, errors: { nama: 'Nama menu sudah ada.' } }, { status: 422 })
    }

    const menu = await prisma.menu.create({
      data: {
        warungId,
        categoryId,
        nama: nama.trim(),
        harga: harga,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
        isAktif: true,
      },
    })

    await syncMenusAcrossWarungs()

    return NextResponse.json({ success: true, data: menu }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/menu]', error)
    return NextResponse.json({ success: false, message: 'Gagal menyimpan menu.' }, { status: 500 })
  }
}
