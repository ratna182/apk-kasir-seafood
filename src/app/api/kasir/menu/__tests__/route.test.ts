/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    menu: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    menuCategory: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireKasirAccess: vi.fn(),
  getKasirWarungId: vi.fn(),
}))

vi.mock('@/lib/activity-log', () => ({
  recordActivity: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({
  apiRateLimiter: {
    check: vi.fn(),
  },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getAuthContext, getKasirWarungId, requireKasirAccess } from '@/lib/auth'
import { recordActivity } from '@/lib/activity-log'
import { apiRateLimiter } from '@/lib/rate-limiter'

const kasirContext = {
  user: { id: 'kasir-1', role: 'KASIR', warungId: 'warung-1' },
  warungId: 'warung-1',
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/kasir/menu', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/kasir/menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(getAuthContext).mockReturnValue(kasirContext as any)
    vi.mocked(requireKasirAccess).mockResolvedValue(null)
    vi.mocked(getKasirWarungId).mockResolvedValue('warung-1')
    vi.mocked(apiRateLimiter.check).mockReturnValue({ allowed: true, remaining: 99, resetIn: 60_000 })
    vi.mocked(prisma.menu.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.menuCategory.upsert).mockResolvedValue({ id: 'cat-lainnya' } as any)
    vi.mocked(prisma.menu.create).mockImplementation(((async ({ data }: any) => ({
      id: 'menu-1',
      ...data,
      category: { id: data.categoryId, nama: 'Lainnya' },
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any))
    vi.mocked(recordActivity).mockResolvedValue(null as any)
  })

  it('returns the auth error when the kasir is not allowed', async () => {
    vi.mocked(requireKasirAccess).mockResolvedValue(
      NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 }),
    )

    const response = await POST(makeRequest({ nama: 'Kepiting', harga: 75_000 }))

    expect(response.status).toBe(403)
  })

  it('rejects a kasir without a warung', async () => {
    vi.mocked(getKasirWarungId).mockResolvedValue(null)

    const response = await POST(makeRequest({ nama: 'Kepiting', harga: 75_000 }))

    expect(response.status).toBe(403)
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('returns 429 when the rate limit is exceeded', async () => {
    vi.mocked(apiRateLimiter.check).mockReturnValue({ allowed: false, remaining: 0, resetIn: 5_000 })

    const response = await POST(makeRequest({ nama: 'Kepiting', harga: 75_000 }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('validates the menu name', async () => {
    const response = await POST(makeRequest({ nama: '   ', harga: 75_000 }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.errors.nama).toBe('Nama menu wajib diisi.')
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('rejects names longer than 100 characters', async () => {
    const response = await POST(makeRequest({ nama: 'a'.repeat(101), harga: 75_000 }))

    expect(response.status).toBe(422)
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('validates the price', async () => {
    const response = await POST(makeRequest({ nama: 'Kepiting', harga: '75.000' }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.errors.harga).toBe('Harga harus angka bulat positif.')
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('rejects a duplicate menu name in the same warung', async () => {
    vi.mocked(prisma.menu.findFirst).mockResolvedValue({ id: 'existing' } as any)

    const response = await POST(makeRequest({ nama: 'Kepiting', harga: 75_000 }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.errors.nama).toBe('Nama menu sudah ada.')
    expect(prisma.menu.create).not.toHaveBeenCalled()
  })

  it('creates the menu in the Lainnya category for the kasir warung', async () => {
    const response = await POST(makeRequest({ nama: '  Kepiting Saus Padang  ', harga: 75_000 }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.nama).toBe('Kepiting Saus Padang')
    expect(prisma.menu.findFirst).toHaveBeenCalledWith({
      where: { warungId: 'warung-1', nama: { equals: 'Kepiting Saus Padang', mode: 'insensitive' } },
      select: { id: true },
    })
    expect(prisma.menuCategory.upsert).toHaveBeenCalledWith({
      where: { warungId_nama: { warungId: 'warung-1', nama: 'Lainnya' } },
      update: {},
      create: { warungId: 'warung-1', nama: 'Lainnya', sortOrder: 0 },
      select: { id: true },
    })
    expect(prisma.menu.create).toHaveBeenCalledWith({
      data: {
        warungId: 'warung-1',
        categoryId: 'cat-lainnya',
        nama: 'Kepiting Saus Padang',
        harga: 75_000,
        isAktif: true,
        sortOrder: 0,
      },
      include: { category: { select: { id: true, nama: true } } },
    })
    expect(recordActivity).toHaveBeenCalledWith(prisma, {
      userId: 'kasir-1',
      warungId: 'warung-1',
      aktivitas: 'TAMBAH_MENU',
      detail: 'Menu "Kepiting Saus Padang" seharga Rp 75.000 ditambahkan dari halaman transaksi',
    })
  })

  it('still creates the menu when activity logging fails', async () => {
    vi.mocked(recordActivity).mockRejectedValue(new Error('log unavailable'))

    const response = await POST(makeRequest({ nama: 'Kepiting', harga: 75_000 }))

    expect(response.status).toBe(201)
  })
})
