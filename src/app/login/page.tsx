'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Eye, EyeOff } from 'lucide-react'
import { DEFAULT_BRANCH_NAME } from '@/lib/branch-config'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const isSubmitting = loading

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (requestRef.current) return

    const normalizedUsername = username.trim().toLowerCase()
    if (!normalizedUsername || !password) {
      setError('Username dan password wajib diisi.')
      return
    }

    setError('')
    setLoading(true)
    setUsername(normalizedUsername)

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    requestRef.current = controller

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalizedUsername, password }),
        signal: controller.signal,
      })

      const data = await res.json().catch(() => null)

      if (res.ok && data?.success) {
        const destination = data.user?.role === 'OWNER' ? '/dashboard' : '/transaksi'
        window.location.replace(destination)
        return
      } else {
        setError(data?.message || 'Login gagal. Periksa username dan password Anda.')
        setPassword('')
      }
    } catch (error) {
      setError(error instanceof DOMException && error.name === 'AbortError'
        ? 'Server terlalu lama merespons. Coba lagi.'
        : 'Gagal terhubung ke server. Periksa koneksi internet Anda.')
    } finally {
      window.clearTimeout(timeoutId)
      requestRef.current = null
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <Image
          src="/cover-seafood.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          style={{ objectFit: 'cover', objectPosition: 'center' }}
        />
        <div className="login-bg-overlay" />
      </div>

      {/* Login card */}
      <div className="login-wrapper">
        <div className="login-card">
          {/* Logo & branding */}
          <div className="login-header">
            <div className="login-logo">VJ</div>
            <h1 className="login-title">{DEFAULT_BRANCH_NAME}</h1>
            <p className="login-subtitle">Seafood & Nasi Uduk</p>
            <p className="login-desc">Sistem Kasir Digital</p>
          </div>

          <h2 className="login-form-title">Masuk ke Kasir</h2>

          {error && (
            <div className="alert alert-error login-alert" role="alert" aria-live="polite">
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="form-input login-input"
                placeholder="Masukkan username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <div className="login-password-wrap">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input login-input"
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="login-eye-btn"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="btn-login"
              className="btn btn-primary btn-full login-submit"
              disabled={isSubmitting || !username.trim() || !password}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner" />
                  <span>Memverifikasi...</span>
                </>
              ) : (
                <span>Masuk</span>
              )}
            </button>
          </form>

          <p className="login-footer">
            Kasir {DEFAULT_BRANCH_NAME} — v1.0
          </p>
        </div>
      </div>
    </div>
  )
}
