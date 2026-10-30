'use client'

import { useState, useEffect } from 'react'
import { Save, X, DollarSign, Database } from 'lucide-react'
import RupiahInput from '@/components/RupiahInput'

interface Warung {
  id: string
  nama: string
  kode: string
}

interface MenuHarga {
  id: string
  nama: string
  hargaDefault: number
  hargaOverride: number | null
}

export default function HargaWarungManager() {
  const [warungs, setWarungs] = useState<Warung[]>([])
  const [selectedWarung, setSelectedWarung] = useState<string>('')
  const [menus, setMenus] = useState<MenuHarga[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [dbReady, setDbReady] = useState(false)

  useEffect(() => {
    loadWarungs()
  }, [])

  useEffect(() => {
    if (selectedWarung) loadMenus(selectedWarung)
  }, [selectedWarung])

  async function runMigration() {
    setMigrating(true)
    try {
      const res = await fetch('/api/admin/migrate', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setDbReady(true)
        showFeedback('success', 'Database siap! Sekarang pilih cabang untuk atur harga.')
      } else {
        showFeedback('error', data.message || 'Gagal setup database')
      }
    } catch {
      showFeedback('error', 'Gagal setup database')
    } finally {
      setMigrating(false)
    }
  }

  async function loadWarungs() {
    try {
      const res = await fetch('/api/admin/warungs')
      const data = await res.json()
      if (data.success) {
        setWarungs(data.data)
      }
    } catch {
      showFeedback('error', 'Gagal memuat warung')
    } finally {
      setLoading(false)
    }
  }

  async function loadMenus(warungId: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/menu?warung_id=${warungId}`)
      const data = await res.json()
      if (data.success) {
        setMenus(data.data.map((m: { id: string; nama: string; harga: number; hargaDefault?: number }) => ({
          id: m.id,
          nama: m.nama,
          hargaDefault: m.hargaDefault || m.harga,
          hargaOverride: m.harga !== m.hargaDefault ? m.harga : null
        })))
      }
    } catch {
      showFeedback('error', 'Gagal memuat menu')
    } finally {
      setLoading(false)
    }
  }

  function showFeedback(type: 'success' | 'error', message: string) {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 4000)
  }

  function handleHargaChange(menuId: string, value: number | null) {
    setMenus(prev => prev.map(m => 
      m.id === menuId ? { ...m, hargaOverride: value } : m
    ))
  }

  async function saveHarga() {
    setSaving(true)
    try {
      const items = menus.map(m => ({
        menuId: m.id,
        harga: m.hargaOverride,
      }))
      const res = await fetch('/api/admin/warung-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warungId: selectedWarung, items }),
      })
      const data = await res.json()
      if (data.success) {
        showFeedback('success', data.message || 'Harga berhasil disimpan!')
        loadMenus(selectedWarung)
      } else {
        showFeedback('error', data.message || 'Gagal menyimpan')
      }
    } catch {
      showFeedback('error', 'Gagal menyimpan harga')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !selectedWarung) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="h-8 w-8 text-green-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Harga per Cabang</h1>
          <p className="text-sm text-gray-500">Atur harga khusus untuk setiap warung</p>
        </div>
      </div>

      {feedback && (
        <div className={`p-4 rounded-lg ${feedback.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {feedback.message}
        </div>
      )}

      {!dbReady && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <Database className="h-6 w-6 text-yellow-600" />
            <h2 className="text-lg font-semibold text-yellow-800">Setup Database Dulu</h2>
          </div>
          <p className="text-sm text-yellow-700 mb-4">
            Klik tombol di bawah untuk membuat tabel harga cabang. Cukup sekali saja.
          </p>
          <button
            onClick={runMigration}
            disabled={migrating}
            className="flex items-center gap-2 bg-yellow-600 text-white px-6 py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50"
          >
            <Database className="h-4 w-4" />
            {migrating ? 'Memproses...' : 'Setup Database Sekarang'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">1. Pilih Cabang yang mau diatur harganya</label>
            <select
              value={selectedWarung}
              onChange={(e) => setSelectedWarung(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Pilih Warung --</option>
              {warungs.map(w => (
                <option key={w.id} value={w.id}>{w.nama} ({w.kode})</option>
              ))}
            </select>
          </div>
          
          {selectedWarung && (
            <button
              onClick={saveHarga}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Menyimpan...' : '2. Simpan Semua Harga'}
            </button>
          )}
        </div>
        {selectedWarung && (
          <p className="mt-3 text-sm text-gray-500">
            Isi <strong>Harga Cabang</strong> untuk menu yang harganya beda. Kosongkan jika pakai harga default.
          </p>
        )}
      </div>

      {selectedWarung && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Menu</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Harga Default</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Harga Cabang</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {menus.map(menu => (
                  <tr key={menu.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {menu.nama}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                      Rp {menu.hargaDefault.toLocaleString('id-ID')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                      <RupiahInput
                        value={menu.hargaOverride ?? ''}
                        onValueChange={(value) => handleHargaChange(menu.id, value === '' ? null : value)}
                        placeholder={menu.hargaDefault.toString()}
                        ariaLabel={`Harga cabang ${menu.nama}`}
                        className="w-32 text-right px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {menu.hargaOverride !== null && (
                        <button
                          onClick={() => handleHargaChange(menu.id, null)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
