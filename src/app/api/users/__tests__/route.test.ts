import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    kasirSesi: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  getAuthContext: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed_password'),
    compare: vi.fn(),
  },
  hash: vi.fn().mockResolvedValue('hashed_password'),
  compare: vi.fn(),
}))

import { GET, POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getAuthContext, requireRole } from '@/lib/auth'

describe('Users API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/users', () => {
    it('should return users for owner with warung_id', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'OWNER' } } as any)
      vi.mocked(requireRole).mockReturnValue(null)
      vi.mocked(prisma.user.findMany).mockResolvedValue([])

      const request = new NextRequest('http://localhost/api/users?warung_id=warung1')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('should return 400 without warung_id', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'OWNER' } } as any)
      vi.mocked(requireRole).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/users')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.success).toBe(false)
    })

    it('should return 403 for non-owner', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'KASIR' } } as any)
      vi.mocked(requireRole).mockReturnValue(new NextResponse('Forbidden', { status: 403 }))

      const request = new NextRequest('http://localhost/api/users?warung_id=warung1')
      const response = await GET(request)

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/users', () => {
    it('should create user with valid data', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'OWNER' } } as any)
      vi.mocked(requireRole).mockReturnValue(null)
      vi.mocked(prisma.user.count).mockResolvedValue(0)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: '2', username: 'kasir1', namaLengkap: 'Kasir Satu', isActive: true,
        createdAt: new Date(), warungId: 'warung1', passwordHash: 'hashed', role: 'KASIR',
      } as any)

      const request = new NextRequest('http://localhost/api/users', {
        method: 'POST',
        body: JSON.stringify({
          warungId: 'warung1', username: 'kasir1', password: 'password123', namaLengkap: 'Kasir Satu',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.success).toBe(true)
    })

    it('should return 422 for duplicate username', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'OWNER' } } as any)
      vi.mocked(requireRole).mockReturnValue(null)
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: '1', username: 'kasir1', passwordHash: 'hashed', namaLengkap: null,
        warungId: 'warung1', role: 'KASIR', isActive: true, createdAt: new Date(),
      } as any)

      const request = new NextRequest('http://localhost/api/users', {
        method: 'POST',
        body: JSON.stringify({ warungId: 'warung1', username: 'kasir1', password: 'password123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
    })

    it('should return 422 with short password', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'OWNER' } } as any)
      vi.mocked(requireRole).mockReturnValue(null)
      vi.mocked(prisma.user.count).mockResolvedValue(0)

      const request = new NextRequest('http://localhost/api/users', {
        method: 'POST',
        body: JSON.stringify({ warungId: 'warung1', username: 'kasir1', password: '123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(422)
      expect(data.success).toBe(false)
    })

    it('should return 409 when two cashiers already exist', async () => {
      vi.mocked(getAuthContext).mockReturnValue({ user: { id: '1', role: 'OWNER' } } as any)
      vi.mocked(requireRole).mockReturnValue(null)
      vi.mocked(prisma.user.count).mockResolvedValue(2)

      const request = new NextRequest('http://localhost/api/users', {
        method: 'POST',
        body: JSON.stringify({ warungId: 'warung1', username: 'kasir3', password: 'password123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.message).toContain('Maksimal 2 akun kasir')
      expect(prisma.user.create).not.toHaveBeenCalled()
    })
  })
})
