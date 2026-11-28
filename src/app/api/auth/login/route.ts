import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { encodeSessionToken, SessionUser, COOKIE_OWNER, COOKIE_KASIR } from '@/lib/session'
import { loginRateLimiter } from '@/lib/rate-limiter'
import { recordActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body
    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : ''

    if (!normalizedUsername || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { success: false, message: 'Username dan password wajib diisi.' },
        { status: 400 }
      )
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'local'
    const rateLimitKey = `${ip}:${normalizedUsername}`
    const limit = loginRateLimiter.check(rateLimitKey)
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: 'Terlalu banyak percobaan. Coba lagi beberapa menit.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } }
      )
    }

    const user = await prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        namaLengkap: true,
        role: true,
        warungId: true,
        isActive: true,
        warung: { select: { id: true, nama: true, kode: true } },
      },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Username atau password salah.' },
        { status: 401 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, message: 'Akun kasir sedang dinonaktifkan owner.' },
        { status: 403 }
      )
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash)
    if (!passwordMatch) {
      return NextResponse.json(
        { success: false, message: 'Username atau password salah.' },
        { status: 401 }
      )
    }

    loginRateLimiter.reset(rateLimitKey)

    if (user.role === 'KASIR') {
      try {
        await recordActivity(prisma, {
          userId: user.id,
          warungId: user.warungId,
          aktivitas: 'LOGIN',
          detail: 'Kasir berhasil login',
        })
      } catch (logError) {
        console.error('[POST /api/auth/login] Warning: gagal mencatat activity log kasir:', logError)
      }
    }

    const sessionUser: SessionUser = {
      id: user.id,
      username: user.username,
      namaLengkap: user.namaLengkap,
      role: user.role,
      warungId: user.warungId,
      warungNama: user.warung?.nama ?? null,
      warungKode: user.warung?.kode ?? null,
    }

    const token = await encodeSessionToken(sessionUser)

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        namaLengkap: user.namaLengkap,
        role: user.role,
        warung: user.warung ? {
          id: user.warung.id,
          nama: user.warung.nama,
          kode: user.warung.kode,
        } : null,
      },
    })

    const isProduction = process.env.NODE_ENV === 'production'
    const cookieName = user.role === 'OWNER' ? COOKIE_OWNER : COOKIE_KASIR

    // Set cookie untuk role yang login
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[POST /api/auth/login]', error)
    return NextResponse.json(
      { success: false, message: 'Terjadi kesalahan server. Silakan coba lagi.' },
      { status: 500 }
    )
  }
}
