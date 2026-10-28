'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, UserCheck, UserX, Trash2, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { formatWibDateTime, formatWibShiftRange } from '@/lib/time'

interface Warung {
  id: string
  nama: string
  kode: string
}

interface KasirUser {
  id: string
  username: string
  namaLengkap: string | null
  isActive: boolean
  createdAt: string
}

interface KasirManagerProps {
  warungs: Warung[]
  userRole: string
}

interface ShiftInfo {
  id: string
  status?: 'TERBUKA' | 'DITUTUP'
  dibukaPada: string | null
  ditutupPada: string | null
  dibukaOleh: string
  ditutupOleh: string | null
  totalTransaksi: number
  totalPendapatan: number
  durationHours?: number
  overtime?: boolean
}

function durationLabel(hours: number): string {
  const minutes = Math.max(0, Math.floor(hours * 60))
  return `${Math.floor(minutes / 60)}j ${minutes % 60}m`
}

export default function KasirManager({ warungs, userRole }: KasirManagerProps) {
  const [selectedWarung, setSelectedWarung] = useState(warungs[0]?.id || '')
  const [users, setUsers] = useState<KasirUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<KasirUser | null>(null)
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    namaLengkap: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [togglingAll, setTogglingAll] = useState(false)
  const [openShift, setOpenShift] = useState<ShiftInfo | null>(null)
  const [latestShift, setLatestShift] = useState<ShiftInfo | null>(null)
  const [openingKasir, setOpeningKasir] = useState(false)
  const [closingKasir, setClosingKasir] = useState(false)
  const [forceCloseOpen, setForceCloseOpen] = useState(false)
  const [forceNote, setForceNote] = useState('')
  const [forceSubmitting, setForceSubmitting] = useState(false)
  const [forceError, setForceError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedWarung) {
      fetchUsers()
      checkKasirStatus()
    }
  }, [selectedWarung])

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await fetch(`/api/users?warung_id=${selectedWarung}`)
      const result = await res.json()
      if (result.success) {
        setUsers(result.data)
      } else {
        setFeedback({ type: 'error', message: result.message || 'Gagal memuat data kasir' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Koneksi ke server terganggu' })
    } finally {
      setLoading(false)
    }
  }

  async function checkKasirStatus() {
    try {
      const res = await fetch(`/api/kasir/status?warungId=${selectedWarung}`)
      const result = await res.json()
      if (result.success) {
        setOpenShift(result.data.shift ?? null)
        setLatestShift(result.data.latestShift ?? null)
      }
    } catch {
      // silent
    }
  }

  async function handleOpenKasir() {
    if (!confirm('Buka shift kasir baru sekarang?')) return
    setOpeningKasir(true)
    try {
      const res = await fetch('/api/kasir/buka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: selectedWarung }),
      })
      const result = await res.json()
      if (result.success) {
        setFeedback({ type: 'success', message: 'Shift kasir berhasil dibuka.' })
        await checkKasirStatus()
      } else {
        setFeedback({ type: 'error', message: result.message || 'Gagal membuka kasir.' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem' })
    } finally {
      setOpeningKasir(false)
    }
  }

  async function handleTutupKasir() {
    if (!confirm('Tutup shift kasir yang sedang berjalan?')) return
    setClosingKasir(true)
    try {
      const res = await fetch('/api/kasir/tutup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: selectedWarung }),
      })
      const result = await res.json()
      if (result.success) {
        setFeedback({ type: 'success', message: 'Shift kasir berhasil ditutup.' })
        await checkKasirStatus()
      } else {
        setFeedback({ type: 'error', message: result.message || 'Gagal menutup kasir.' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem' })
    } finally {
      setClosingKasir(false)
    }
  }

  async function handleTutupPaksa() {
    if (forceNote.trim().length < 5) {
      setForceError('Catatan wajib diisi minimal 5 karakter.')
      return
    }
    setForceSubmitting(true)
    setForceError(null)
    try {
      const res = await fetch('/api/kasir/tutup-paksa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: selectedWarung, catatan: forceNote.trim() }),
      })
      const result = await res.json()
      if (result.success) {
        setForceCloseOpen(false)
        setForceNote('')
        setFeedback({ type: 'success', message: result.message || 'Shift ditutup paksa.' })
        await checkKasirStatus()
      } else {
        setForceError(result.message || 'Gagal menutup paksa shift.')
      }
    } catch {
      setForceError('Terjadi kesalahan sistem.')
    } finally {
      setForceSubmitting(false)
    }
  }

  function handleOpenForm(user?: KasirUser) {
    if (user) {
      setEditingUser(user)
      setFormData({
        username: user.username,
        password: '',
        namaLengkap: user.namaLengkap || '',
      })
    } else {
      setEditingUser(null)
      setFormData({ username: '', password: '', namaLengkap: '' })
    }
    setErrors({})
    setShowForm(true)
  }

  function handleCloseForm() {
    setShowForm(false)
    setEditingUser(null)
    setFormData({ username: '', password: '', namaLengkap: '' })
    setErrors({})
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    setSubmitting(true)

    try {
      if (editingUser) {
        const updateData: Record<string, unknown> = {
          namaLengkap: formData.namaLengkap || null,
        }
        if (formData.password) {
          updateData.password = formData.password
        }

        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        })
        const result = await res.json()

        if (result.success) {
          setFeedback({ type: 'success', message: 'Kasir berhasil diupdate!' })
          handleCloseForm()
          fetchUsers()
        } else {
          setErrors(result.errors || { message: result.message })
        }
      } else {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warungId: selectedWarung,
            username: formData.username,
            password: formData.password,
            namaLengkap: formData.namaLengkap || null,
          }),
        })
        const result = await res.json()

        if (result.success) {
          setFeedback({ type: 'success', message: 'Kasir berhasil dibuat!' })
          handleCloseForm()
          fetchUsers()
        } else {
          setErrors(result.errors || { message: result.message })
        }
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleActive(user: KasirUser) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      const result = await res.json()

      if (result.success) {
        setFeedback({
          type: 'success',
          message: user.isActive ? 'Kasir berhasil dinonaktifkan' : 'Kasir berhasil diaktifkan',
        })
        fetchUsers()
      } else {
        setFeedback({ type: 'error', message: result.message })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem' })
    }
  }

  async function handleToggleAll(isActive: boolean) {
    const action = isActive ? 'mengaktifkan' : 'menonaktifkan'
    if (!confirm(`Yakin ${action} semua akun kasir?`)) return

    setTogglingAll(true)
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      const result = await res.json()
      if (result.success) {
        setFeedback({ type: 'success', message: `${result.data.count} akun kasir berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.` })
        fetchUsers()
      } else {
        setFeedback({ type: 'error', message: result.message || 'Gagal mengubah status semua kasir.' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem' })
    } finally {
      setTogglingAll(false)
    }
  }

  async function handleDelete(user: KasirUser) {
    if (!confirm(`Hapus kasir "${user.username}"?`)) return

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
      })
      const result = await res.json()

      if (result.success) {
        setFeedback({ type: 'success', message: 'Kasir berhasil dihapus!' })
        fetchUsers()
      } else {
        setFeedback({ type: 'error', message: result.message })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Terjadi kesalahan sistem' })
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Manajemen Kasir</h1>
          <p className="text-secondary text-sm">Kelola akun kasir untuk setiap outlet</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {!openShift && (
            <button type="button" onClick={handleOpenKasir} disabled={openingKasir} className="btn btn-success">
              {openingKasir ? 'Membuka...' : 'Buka Kasir'}
            </button>
          )}
          {openShift && (
            <button type="button" onClick={handleTutupKasir} disabled={closingKasir} className="btn btn-danger">
              {closingKasir ? 'Menutup...' : 'Tutup Shift'}
            </button>
          )}
          {userRole === 'OWNER' && openShift && (
            <button type="button" onClick={() => { setForceCloseOpen(true); setForceNote(''); setForceError(null) }} className="btn btn-ghost" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
              Tutup Paksa
            </button>
          )}
          {userRole === 'OWNER' && (
            <>
              <button type="button" onClick={() => handleToggleAll(true)} disabled={togglingAll} className="btn btn-success">Aktifkan Semua Kasir</button>
              <button type="button" onClick={() => handleToggleAll(false)} disabled={togglingAll} className="btn btn-danger">Nonaktifkan Semua Kasir</button>
            </>
          )}
          <button type="button" onClick={() => handleOpenForm()} className="btn btn-primary"><Plus size={16} /> Tambah Kasir</button>
        </div>
      </div>

      {feedback && (
        <div className={`alert ${feedback.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1rem' }}>
          {feedback.message}
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <label className="form-label">Pilih Warung</label>
        <select
          className="form-input"
          value={selectedWarung}
          onChange={(e) => setSelectedWarung(e.target.value)}
          style={{ maxWidth: '400px' }}
        >
          {warungs.map((w) => (
            <option key={w.id} value={w.id}>
              {w.nama} ({w.kode})
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', borderLeft: `3px solid ${openShift?.overtime ? 'var(--color-danger)' : openShift ? 'var(--color-success)' : 'var(--color-border)'}` }}>
        {openShift ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <strong>Shift Buka</strong>
                <p className="text-sm text-secondary" style={{ margin: 0 }}>
                  {formatWibShiftRange(openShift.dibukaPada, openShift.ditutupPada)} • oleh {openShift.dibukaOleh}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ color: openShift.overtime ? 'var(--color-danger)' : 'inherit' }}>
                  {durationLabel(openShift.durationHours ?? 0)}
                </strong>
                <p className="text-sm text-secondary" style={{ margin: 0 }}>
                  {openShift.totalTransaksi} transaksi • Rp {openShift.totalPendapatan.toLocaleString('id-ID')}
                </p>
              </div>
            </div>
            {openShift.overtime && (
              <div className="alert alert-error" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                <div>
                  <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Shift sudah berjalan &gt; 18 jam. {userRole === 'OWNER' ? 'Gunakan Tutup Paksa dengan catatan.' : 'Minta owner menutup paksa shift.'}
                </div>
              </div>
            )}
          </div>
        ) : latestShift ? (
          <div>
            <strong>Shift Terakhir Ditutup</strong>
            <p className="text-sm text-secondary" style={{ margin: 0 }}>
              {formatWibShiftRange(latestShift.dibukaPada, latestShift.ditutupPada)}
              {latestShift.ditutupOleh ? ` oleh ${latestShift.ditutupOleh}` : ''} • {latestShift.totalTransaksi} transaksi
            </p>
          </div>
        ) : (
          <div>
            <strong>Belum Ada Shift</strong>
            <p className="text-sm text-secondary" style={{ margin: 0 }}>Buka kasir untuk mulai menerima transaksi.</p>
          </div>
        )}
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>No</th>
              <th>Username</th>
              <th>Nama Lengkap</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center' }}>Memuat data...</td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center' }}>Belum ada kasir</td>
              </tr>
            ) : (
              users.map((user, index) => (
                <tr key={user.id}>
                  <td>{index + 1}</td>
                  <td><strong>{user.username}</strong></td>
                  <td>{user.namaLengkap || '-'}</td>
                  <td>
                    <span className={`badge ${user.isActive ? 'badge-success' : 'badge-warning'}`}>
                      {user.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenForm(user)}
                        className="btn btn-sm btn-ghost"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(user)}
                        className={`btn btn-sm ${user.isActive ? 'btn-ghost' : 'btn-success'}`}
                      >
                        {user.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(user)}
                        className="btn btn-sm btn-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={handleCloseForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editingUser ? 'Edit Kasir' : 'Tambah Kasir Baru'}</h2>
            
            {errors.message && (
              <div className="alert alert-error">{errors.message}</div>
            )}

            <form onSubmit={handleSubmit}>
              {!editingUser && (
                <div className="form-group">
                  <label className="form-label">Username *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    placeholder="Masukkan username"
                    required
                  />
                  {errors.username && <span className="text-danger text-sm">{errors.username}</span>}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">
                  Password {editingUser ? '(Kosongkan jika tidak diubah)' : '*'}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={editingUser ? 'Masukkan password baru' : 'Masukkan password'}
                    required={!editingUser}
                    minLength={6}
                    style={{ paddingRight: '44px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <span className="text-danger text-sm">{errors.password}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Nama Lengkap</label>
                <input
                  type="text"
                  className="form-input"
                  value={formData.namaLengkap}
                  onChange={(e) => setFormData({ ...formData, namaLengkap: e.target.value })}
                  placeholder="Masukkan nama lengkap"
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" onClick={handleCloseForm} className="btn btn-ghost">
                  Batal
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Menyimpan...' : editingUser ? 'Update' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {forceCloseOpen && openShift && (
        <div className="modal-overlay" onClick={() => setForceCloseOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title" style={{ color: 'var(--color-danger)' }}>Tutup Paksa Shift</h2>
            <p className="text-sm text-secondary">
              Shift dibuka {formatWibDateTime(openShift.dibukaPada)} WIB oleh {openShift.dibukaOleh}. Durasi {durationLabel(openShift.durationHours ?? 0)}.
            </p>
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              Pesanan yang belum dibayar pada shift ini akan dibatalkan. Catatan tersimpan permanen di log shift.
            </div>
            <div className="form-group">
              <label className="form-label">Catatan (wajib)</label>
              <textarea
                className="form-input"
                rows={3}
                value={forceNote}
                onChange={(e) => setForceNote(e.target.value)}
                placeholder="Contoh: kasir lupa menutup shift, sudah dikonfirmasi via telepon."
              />
            </div>
            {forceError && <div className="alert alert-error">{forceError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setForceCloseOpen(false)} disabled={forceSubmitting}>Batal</button>
              <button type="button" className="btn btn-danger" onClick={handleTutupPaksa} disabled={forceSubmitting}>
                {forceSubmitting ? 'Memproses...' : 'Tutup Paksa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
