'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react'
import { sortByName } from '@/lib/menu-sort'

interface Category {
  id: string
  nama: string
  sortOrder: number
  isAktif: boolean
  _count: { menus: number }
}

interface MenuItem {
  id: string
  nama: string
  harga: number
  isAktif: boolean
  sortOrder: number
  categoryId: string
}

export default function MenuManager() {
  const [categories, setCategories] = useState<Category[]>([])
  const [menusByCategory, setMenusByCategory] = useState<Record<string, MenuItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [catModalOpen, setCatModalOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [catName, setCatName] = useState('')
  const [catSaving, setCatSaving] = useState(false)

  const [menuModalOpen, setMenuModalOpen] = useState(false)
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null)
  const [menuForm, setMenuForm] = useState({ nama: '', harga: '', categoryId: '', isAktif: true })
  const [menuErrors, setMenuErrors] = useState<Record<string, string>>({})
  const [menuSaving, setMenuSaving] = useState(false)
  const [deletingMenuId, setDeletingMenuId] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [catRes, menuRes] = await Promise.all([
        fetch('/api/menu/categories'),
        fetch('/api/menu'),
      ])
      const catData = await catRes.json()
      const menuData = await menuRes.json()
      if (catData.success) {
        setCategories(sortByName(catData.data))
        const grouped: Record<string, MenuItem[]> = {}
        for (const cat of catData.data) grouped[cat.id] = []
        if (menuData.success) {
          for (const m of sortByName<MenuItem>(menuData.data)) {
            if (grouped[m.categoryId]) grouped[m.categoryId].push(m)
          }
        }
        setMenusByCategory(grouped)
      } else {
        showFeedback('error', catData.message || 'Gagal memuat data')
      }
    } catch {
      showFeedback('error', 'Koneksi ke server gagal')
    } finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [])

  async function handleSyncMenus() {
    setSyncing(true)
    try {
      const res = await fetch('/api/menu/sync', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        showFeedback('success', data.message || 'Menu berhasil disinkronkan ke semua kasir.')
        loadAll()
      } else {
        showFeedback('error', data.message || 'Gagal sync menu.')
      }
    } catch {
      showFeedback('error', 'Gagal sync menu.')
    } finally {
      setSyncing(false)
    }
  }

  function showFeedback(type: 'success' | 'error', message: string) {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 4000)
  }

  // ── Category CRUD ──

  function openAddCat() { setEditingCat(null); setCatName(''); setCatModalOpen(true) }
  function openEditCat(cat: Category) { setEditingCat(cat); setCatName(cat.nama); setCatModalOpen(true) }

  async function saveCat() {
    if (!catName.trim()) { showFeedback('error', 'Nama kategori wajib diisi.'); return }
    setCatSaving(true)
    try {
      if (editingCat) {
        const res = await fetch(`/api/menu/categories/${editingCat.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nama: catName.trim() }),
        })
        const data = await res.json()
        if (data.success) { showFeedback('success', 'Kategori diperbarui.'); setCatModalOpen(false); loadAll() }
        else showFeedback('error', data.errors?.nama || data.message || 'Gagal')
      } else {
        const maxSort = categories.length > 0 ? Math.max(...categories.map((c) => c.sortOrder)) + 1 : 0
        const res = await fetch('/api/menu/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nama: catName.trim(), sortOrder: maxSort }),
        })
        const data = await res.json()
        if (data.success) { showFeedback('success', 'Kategori dibuat.'); setCatModalOpen(false); loadAll() }
        else showFeedback('error', data.errors?.nama || data.message || 'Gagal')
      }
    } catch { showFeedback('error', 'Terjadi kesalahan.') }
    finally { setCatSaving(false) }
  }

  async function deleteCat(cat: Category) {
    if (cat._count.menus > 0) {
      if (!window.confirm(`Kategori "${cat.nama}" masih ada ${cat._count.menus} menu. Hapus semua menu dulu, atau pindahkan ke kategori lain.`)) return
      return
    }
    if (!window.confirm(`Hapus kategori "${cat.nama}"?`)) return
    try {
      const res = await fetch(`/api/menu/categories/${cat.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) { showFeedback('success', 'Kategori dihapus.'); loadAll() }
      else showFeedback('error', data.message || 'Gagal menghapus')
    } catch { showFeedback('error', 'Gagal menghapus kategori.') }
  }

  async function moveCat(cat: Category, direction: 'up' | 'down') {
    const idx = categories.findIndex((c) => c.id === cat.id)
    if (idx < 0) return
    const target = direction === 'up' ? categories[idx - 1] : categories[idx + 1]
    if (!target) return
    await Promise.all([
      fetch(`/api/menu/categories/${cat.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: target.sortOrder }) }),
      fetch(`/api/menu/categories/${target.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: cat.sortOrder }) }),
    ])
    loadAll()
  }

  // ── Menu CRUD ──

  function openAddMenu(categoryId: string) {
    setEditingMenu(null)
    setMenuForm({ nama: '', harga: '', categoryId, isAktif: true })
    setMenuErrors({})
    setMenuModalOpen(true)
  }

  function openEditMenu(menu: MenuItem) {
    setEditingMenu(menu)
    setMenuForm({ nama: menu.nama, harga: menu.harga.toString(), categoryId: menu.categoryId, isAktif: menu.isAktif })
    setMenuErrors({})
    setMenuModalOpen(true)
  }

  async function saveMenu(e: React.FormEvent) {
    e.preventDefault()
    setMenuErrors({})
    const errors: Record<string, string> = {}
    if (!menuForm.nama.trim()) errors.nama = 'Nama menu wajib diisi.'
    if (!menuForm.harga || isNaN(Number(menuForm.harga)) || Number(menuForm.harga) < 0) errors.harga = 'Harga harus angka valid.'
    if (!menuForm.categoryId) errors.categoryId = 'Kategori wajib dipilih.'
    if (Object.keys(errors).length > 0) { setMenuErrors(errors); return }
    setMenuSaving(true)
    try {
      const body = { nama: menuForm.nama.trim(), harga: Number(menuForm.harga), categoryId: menuForm.categoryId, isAktif: menuForm.isAktif }
      if (editingMenu) {
        const res = await fetch(`/api/menu/${editingMenu.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json()
        if (data.success) { showFeedback('success', `Menu "${menuForm.nama}" diperbarui.`); setMenuModalOpen(false); loadAll() }
        else { if (data.errors) setMenuErrors(data.errors); else showFeedback('error', data.message || 'Gagal') }
      } else {
        const res = await fetch('/api/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json()
        if (data.success) { showFeedback('success', `Menu "${menuForm.nama}" ditambahkan.`); setMenuModalOpen(false); loadAll() }
        else { if (data.errors) setMenuErrors(data.errors); else showFeedback('error', data.message || 'Gagal') }
      }
    } catch { showFeedback('error', 'Terjadi kesalahan.') }
    finally { setMenuSaving(false) }
  }

  async function toggleMenuStatus(menu: MenuItem) {
    try {
      const res = await fetch(`/api/menu/${menu.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isAktif: !menu.isAktif }) })
      const data = await res.json()
      if (data.success) { showFeedback('success', `Menu "${menu.nama}" sekarang ${!menu.isAktif ? 'Aktif' : 'Nonaktif'}`); loadAll() }
      else showFeedback('error', data.message || 'Gagal')
    } catch { showFeedback('error', 'Gagal update status.') }
  }

  async function deleteMenu(menu: MenuItem) {
    if (!window.confirm(`Hapus menu "${menu.nama}"?`)) return
    setDeletingMenuId(menu.id)
    try {
      const res = await fetch(`/api/menu/${menu.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) { showFeedback('success', `Menu "${menu.nama}" dihapus.`); loadAll() }
      else showFeedback('error', data.message || 'Gagal menghapus.')
    } catch { showFeedback('error', 'Gagal menghapus menu.') }
    finally { setDeletingMenuId(null) }
  }

  async function moveMenu(menu: MenuItem, direction: 'up' | 'down') {
    const siblings = menusByCategory[menu.categoryId] || []
    const idx = siblings.findIndex((m) => m.id === menu.id)
    if (idx < 0) return
    const target = direction === 'up' ? siblings[idx - 1] : siblings[idx + 1]
    if (!target) return
    await Promise.all([
      fetch(`/api/menu/${menu.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: target.sortOrder }) }),
      fetch(`/api/menu/${target.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sortOrder: menu.sortOrder }) }),
    ])
    loadAll()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '4px' }}>Kelola Menu</h1>
          <p className="text-secondary text-sm">Atur kategori, menu, harga, dan urutan tampil.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={handleSyncMenus} disabled={syncing} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing...' : 'Sync ke Semua Kasir'}
          </button>
          <button onClick={openAddCat} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={16} /> Tambah Kategori
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`alert ${feedback.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1.25rem', animation: 'fadeIn 0.2s ease-out' }}>
          {feedback.message}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem' }} />
          <p className="text-secondary">Memuat data menu...</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <h3>Belum Ada Kategori</h3>
          <p className="text-secondary text-sm" style={{ marginBottom: '1.5rem' }}>Buat kategori dulu untuk mengorganisir menu.</p>
          <button onClick={openAddCat} className="btn btn-primary btn-sm">Tambah Kategori Pertama</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {categories.map((cat, catIdx) => (
            <div key={cat.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1.25rem', background: 'var(--color-surface-raised)', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{cat.nama}</h2>
                  <span className="badge" style={{ background: 'var(--color-brand-soft)', color: 'var(--color-brand)', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '10px' }}>
                    {cat._count.menus} menu
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <button onClick={() => moveCat(cat, 'up')} disabled={catIdx === 0} className="btn btn-ghost btn-sm" style={{ padding: '4px', opacity: catIdx === 0 ? 0.3 : 1 }} title="Naik"><ArrowUp size={14} /></button>
                  <button onClick={() => moveCat(cat, 'down')} disabled={catIdx === categories.length - 1} className="btn btn-ghost btn-sm" style={{ padding: '4px', opacity: catIdx === categories.length - 1 ? 0.3 : 1 }} title="Turun"><ArrowDown size={14} /></button>
                  <button onClick={() => openEditCat(cat)} className="btn btn-ghost btn-sm" style={{ padding: '4px' }} title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => deleteCat(cat)} className="btn btn-ghost btn-sm" style={{ padding: '4px', color: 'var(--color-danger)' }} title="Hapus"><Trash2 size={14} /></button>
                </div>
              </div>

              <div style={{ padding: '0.75rem 1.25rem' }}>
                <button onClick={() => openAddMenu(cat.id)} className="btn btn-ghost btn-sm" style={{ marginBottom: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Plus size={14} /> Tambah Menu
                </button>

                {(menusByCategory[cat.id] || []).length === 0 ? (
                  <p className="text-secondary text-sm" style={{ margin: '0.5rem 0' }}>Belum ada menu di kategori ini.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={{ padding: '0.5rem 0', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Nama Menu</th>
                        <th style={{ padding: '0.5rem 0', textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Harga</th>
                        <th style={{ padding: '0.5rem 0', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Status</th>
                        <th style={{ padding: '0.5rem 0', textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(menusByCategory[cat.id] || []).map((menu, menuIdx) => {
                        const siblings = menusByCategory[cat.id] || []
                        return (
                          <tr key={menu.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: menu.isAktif ? 1 : 0.6 }}>
                            <td style={{ padding: '0.75rem 0' }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{menu.nama}</span>
                            </td>
                            <td style={{ padding: '0.75rem 0', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              Rp {menu.harga.toLocaleString('id-ID')}
                            </td>
                            <td style={{ padding: '0.75rem 0', textAlign: 'center' }}>
                              <button onClick={() => toggleMenuStatus(menu)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                <span className={`badge ${menu.isAktif ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '10px' }}>
                                  {menu.isAktif ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </button>
                            </td>
                            <td style={{ padding: '0.75rem 0', textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                                <button onClick={() => moveMenu(menu, 'up')} disabled={menuIdx === 0} className="btn btn-ghost btn-sm" style={{ padding: '2px', opacity: menuIdx === 0 ? 0.3 : 1 }}><ArrowUp size={12} /></button>
                                <button onClick={() => moveMenu(menu, 'down')} disabled={menuIdx === siblings.length - 1} className="btn btn-ghost btn-sm" style={{ padding: '2px', opacity: menuIdx === siblings.length - 1 ? 0.3 : 1 }}><ArrowDown size={12} /></button>
                                <button onClick={() => openEditMenu(menu)} className="btn btn-ghost btn-sm" style={{ padding: '2px' }}><Pencil size={12} /></button>
                                <button onClick={() => deleteMenu(menu)} disabled={deletingMenuId === menu.id} className="btn btn-ghost btn-sm" style={{ padding: '2px', color: 'var(--color-danger)' }}><Trash2 size={12} /></button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Category Modal */}
      {catModalOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000, animation: 'fadeIn 0.2s ease-out' }}
          onClick={(e) => { if (e.target === e.currentTarget) setCatModalOpen(false) }}>
          <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '1.75rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', animation: 'scaleIn 0.2s ease-out' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '1.25rem' }}>{editingCat ? 'Edit Kategori' : 'Tambah Kategori'}</h2>
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">Nama Kategori *</label>
              <input type="text" className="form-input" placeholder="Contoh: Udang, Kerang, Minuman" value={catName} onChange={(e) => setCatName(e.target.value)} autoFocus />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setCatModalOpen(false)} disabled={catSaving} className="btn btn-ghost">Batal</button>
              <button type="button" onClick={saveCat} disabled={catSaving} className="btn btn-primary" style={{ minWidth: '100px' }}>{catSaving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Menu Modal */}
      {menuModalOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000, animation: 'fadeIn 0.2s ease-out' }}
          onClick={(e) => { if (e.target === e.currentTarget) setMenuModalOpen(false) }}>
          <div className="card" style={{ width: '100%', maxWidth: '480px', padding: '1.75rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', animation: 'scaleIn 0.2s ease-out' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '1.25rem' }}>{editingMenu ? 'Edit Menu' : 'Tambah Menu Baru'}</h2>
            <form onSubmit={saveMenu}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Nama Menu *</label>
                <input type="text" className="form-input" placeholder="Contoh: Kepiting Saus Padang" value={menuForm.nama} onChange={(e) => setMenuForm({ ...menuForm, nama: e.target.value })} autoFocus required />
                {menuErrors.nama && <span className="text-danger text-sm">{menuErrors.nama}</span>}
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Kategori *</label>
                <select className="form-input" value={menuForm.categoryId} onChange={(e) => setMenuForm({ ...menuForm, categoryId: e.target.value })}>
                  <option value="">Pilih Kategori</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.nama}</option>
                  ))}
                </select>
                {menuErrors.categoryId && <span className="text-danger text-sm">{menuErrors.categoryId}</span>}
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Harga Jual (Rp) *</label>
                <input type="number" min="0" step="500" className="form-input" placeholder="35000" value={menuForm.harga} onChange={(e) => setMenuForm({ ...menuForm, harga: e.target.value })} required />
                {menuErrors.harga && <span className="text-danger text-sm">{menuErrors.harga}</span>}
              </div>
              {editingMenu && (
                <div className="form-group" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)' }}>
                  <input type="checkbox" id="chk-aktif" checked={menuForm.isAktif} onChange={(e) => setMenuForm({ ...menuForm, isAktif: e.target.checked })} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  <label htmlFor="chk-aktif" style={{ cursor: 'pointer', fontSize: '0.875rem', color: 'var(--color-text-primary)' }}><strong>Menu Aktif</strong> (tampil di halaman kasir)</label>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="button" onClick={() => setMenuModalOpen(false)} disabled={menuSaving} className="btn btn-ghost">Batal</button>
                <button type="submit" disabled={menuSaving} className="btn btn-primary" style={{ minWidth: '120px' }}>{menuSaving ? 'Menyimpan...' : editingMenu ? 'Simpan' : 'Tambah'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
