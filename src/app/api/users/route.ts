import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'
import bcrypt from 'bcryptjs'

// GET /api/users — ambil semua user kasir untuk warung tertentu
export async function GET(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    
    // Hanya owner yang boleh akses
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const { searchParams } = new URL(request.url)
    const warungId = searchParams.get('warung_id')

    if (!warungId) {
      return NextResponse.json({ success: false, message: 'warung_id wajib diisi.' }, { status: 400 })
    }

    // Ambil semua kasir untuk warung tertentu
    const users = await prisma.user.findMany({
      where: {
        warungId,
        role: 'KASIR',
      },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, data: users })
  } catch (error) {
    console.error('[GET /api/users]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengambil data user.' }, { status: 500 })
  }
}

// POST /api/users — buat akun kasir baru
export async function POST(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    
    // Hanya owner yang boleh buat akun kasir
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const body = await request.json()
    const { warungId, username, password, namaLengkap } = body

    // Validasi
    if (!warungId) {
      return NextResponse.json({ success: false, errors: { warungId: 'Warung wajib dipilih.' } }, { status: 422 })
    }
    if (!username || !username.trim()) {
      return NextResponse.json({ success: false, errors: { username: 'Username wajib diisi.' } }, { status: 422 })
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ success: false, errors: { password: 'Password minimal 6 karakter.' } }, { status: 422 })
    }

    const kasirCount = await prisma.user.count({ where: { role: 'KASIR' } })
    if (kasirCount >= 2) {
      return NextResponse.json({
        success: false,
        message: 'Maksimal 2 akun kasir sudah tercapai.',
      }, { status: 409 })
    }

    // Cek duplikat username
    const existing = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existing) {
      return NextResponse.json({ success: false, errors: { username: 'Username sudah digunakan.' } }, { status: 422 })
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 8)

    // Buat user
    const user = await prisma.user.create({
      data: {
        warungId,
        username: username.trim().toLowerCase(),
        passwordHash,
        namaLengkap: namaLengkap?.trim() || null,
        role: 'KASIR',
        isActive: true,
      },
      select: {
        id: true,
        username: true,
        namaLengkap: true,
        isActive: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ success: true, data: user }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Maksimal 2 akun kasir')) {
      return NextResponse.json({
        success: false,
        message: 'Maksimal 2 akun kasir sudah tercapai.',
      }, { status: 409 })
    }
    console.error('[POST /api/users]', error)
    return NextResponse.json({ success: false, message: 'Gagal membuat akun kasir.' }, { status: 500 })
  }
}

// PATCH /api/users — aktifkan atau nonaktifkan seluruh akun kasir
export async function PATCH(request: NextRequest) {
  try {
    const context = getAuthContext(request)
    const authError = requireRole(context, 'OWNER')
    if (authError) return authError

    const { isActive } = await request.json()
    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ success: false, message: 'Status kasir wajib diisi.' }, { status: 422 })
    }

    const result = await prisma.user.updateMany({ where: { role: 'KASIR' }, data: { isActive } })
    return NextResponse.json({ success: true, data: { count: result.count, isActive } })
  } catch (error) {
    console.error('[PATCH /api/users]', error)
    return NextResponse.json({ success: false, message: 'Gagal mengubah status kasir.' }, { status: 500 })
  }
}
