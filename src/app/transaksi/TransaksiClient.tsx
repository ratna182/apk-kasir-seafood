'use client'

import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Search, ShoppingCart, X, Minus, Plus, Printer, CreditCard, Banknote, CheckCircle, Trash2, Pencil, Eye } from 'lucide-react'
import Receipt, { type PrinterWidth } from '@/components/Receipt'
import NotaPreview, { type NotaPreviewItem } from '@/components/NotaPreview'
import PrinterSetup from '@/components/PrinterSetup'
import PrinterStatusBadge from '@/components/PrinterStatus'
import { printer } from '@/lib/printer'
import { loadPrinterConfig } from '@/lib/printer/storage'
import { encodeReceipt } from '@/lib/printer/receipt-encoder'
import { hitungKembalian, generateQuickAmounts } from '@/lib/payment/cash'
import { QUICK_TABLES, LESEHAN } from '@/lib/table-layout'
import { sortByName } from '@/lib/menu-sort'

interface Menu {
  id: string
  nama: string
  harga: number
  isAktif: boolean
  categoryId: string
  category: { id: string; nama: string }
}

interface CartItem {
  menuId: string
  nama: string
  harga: number
  qty: number
  hargaSementara?: number
  diskonSatuan: number
  catatan: string
}

interface CompletedTransaksi {
  id: string
  nomorMeja: string
  total: number
  metodePembayaran?: string | null
  tanggal: string
  createdAt: string
  items: Array<{
    id?: string
    namaMenu: string
    hargaSatuan: number
    diskonSatuan?: number
    catatan?: string | null
    qty: number
    subtotal: number
  }>
}

type ActiveOrder = CompletedTransaksi & {
  updatedAt: string
  minutesOpen: number
}

type ReceiptPaymentMeta = {
  uangDiterima: number
  kembalian: number
}

type PreviewNotaData = {
  orderId: string | null
  nomorMeja: string
  warungNama: string
  warungAlamat: string | null
  generatedAt: string
  items: NotaPreviewItem[]
  total: number
  existingTotal: number
  addedTotal: number
}

interface TransaksiClientProps {
  session: {
    warungNama: string | null
    warungKode: string | null
    warungAlamat?: string | null
    namaLengkap?: string | null
    username: string
    role: string
  }
  menus: Menu[]
  initialActiveOrders: ActiveOrder[]
  isKasirClosed: boolean
  isShiftOvertime?: boolean
}

const TABLE_SECTION_GAP = '__table-section-gap__'

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '')
  }
  return `${Date.now()}${Math.random().toString(36).slice(2)}`
}

export default function TransaksiClient({ session, menus: initialMenus, initialActiveOrders, isKasirClosed, isShiftOvertime }: TransaksiClientProps) {
  const isKranggan = session.username.toLowerCase().includes('kranggan') || session.warungNama?.toLowerCase().includes('kranggan')
  const hasLesehan = session.username === 'kasir1' || isKranggan
  const quickTables = hasLesehan ? [...LESEHAN, TABLE_SECTION_GAP, ...QUICK_TABLES] : QUICK_TABLES
  const [cart, setCart] = useState<CartItem[]>([])
  const [nomorMeja, setNomorMeja] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>(initialActiveOrders)
  const [selectedOrder, setSelectedOrder] = useState<ActiveOrder | null>(null)
  const [metodePembayaran, setMetodePembayaran] = useState<'CASH' | 'QRIS' | 'TRANSFER'>('CASH')
  const [completedTransaksi, setCompletedTransaksi] = useState<CompletedTransaksi | null>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [printerWidth, setPrinterWidth] = useState<PrinterWidth>('80mm')
  const [menus] = useState<Menu[]>(initialMenus)
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null)
  const [qtyPickerMenuId, setQtyPickerMenuId] = useState<string | null>(null)
  const [qtyPickerPos, setQtyPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [qtyPickerPlacement, setQtyPickerPlacement] = useState<'above' | 'below'>('above')
  const qtyBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const printJobSeq = useRef(0)

  const [showPrinterSetup, setShowPrinterSetup] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [uangDiterima, setUangDiterima] = useState<number | ''>('')
  const [kembalianResult, setKembalianResult] = useState<ReturnType<typeof hitungKembalian> | null>(null)
  const [receiptPayment, setReceiptPayment] = useState<ReceiptPaymentMeta | null>(null)
  const [showBayarLangsung, setShowBayarLangsung] = useState(false)
  const [showPreviewNota, setShowPreviewNota] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewData, setPreviewData] = useState<PreviewNotaData | null>(null)
  const [bayarLangsungMetode, setBayarLangsungMetode] = useState<'CASH' | 'QRIS' | 'TRANSFER'>('CASH')
  const [bayarLangsungUang, setBayarLangsungUang] = useState<number | ''>('')
  const [bayarLangsungError, setBayarLangsungError] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey)

  useEffect(() => {
    const saved = loadPrinterConfig()
    if (saved) {
      setPrinterWidth(saved.width)
      printer.autoReconnect()
    }
  }, [])

  useEffect(() => {
    if (!qtyPickerMenuId) return
    const handler = () => setQtyPickerMenuId(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [qtyPickerMenuId])

  const filteredMenus = useMemo(() => {
    return menus.filter((menu) => {
      const matchesSearch = menu.nama.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = !activeCategoryId || menu.categoryId === activeCategoryId
      return matchesSearch && matchesCategory
    })
  }, [menus, search, activeCategoryId])

  const cartByMenuId = useMemo(() => new Map(cart.map((item) => [item.menuId, item])), [cart])

  const categories = useMemo(() => {
    const seen = new Map<string, { id: string; nama: string; count: number }>()
    for (const menu of menus) {
      if (!menu.isAktif) continue
      const existing = seen.get(menu.categoryId)
      if (existing) existing.count++
      else seen.set(menu.categoryId, { id: menu.categoryId, nama: menu.category.nama, count: 1 })
    }
    return sortByName(Array.from(seen.values()))
  }, [menus])

  const menusByCategory = useMemo(() => {
    const grouped = new Map<string, Menu[]>()
    for (const menu of filteredMenus) {
      const list = grouped.get(menu.categoryId) || []
      list.push(menu)
      grouped.set(menu.categoryId, list)
    }
    for (const [categoryId, items] of grouped) grouped.set(categoryId, sortByName(items))
    return grouped
  }, [filteredMenus])

  const quickAmounts = useMemo(() => {
    if (!selectedOrder) return []
    return generateQuickAmounts(selectedOrder.total)
  }, [selectedOrder?.total])

  useEffect(() => {
    if (metodePembayaran !== 'CASH' || !selectedOrder) {
      setKembalianResult(null)
      return
    }
    if (uangDiterima === '' || uangDiterima < 0) {
      setKembalianResult(null)
      return
    }
    setKembalianResult(hitungKembalian(uangDiterima, selectedOrder.total))
  }, [uangDiterima, selectedOrder?.total, metodePembayaran])

  const loadActiveOrders = useCallback(async () => {
    const res = await fetch('/api/transaksi/open')
    const data = await res.json()
    if (data.success) {
      const now = Date.now()
      setActiveOrders(data.data.map((order: ActiveOrder) => ({
        ...order,
        minutesOpen: Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60000)),
      })))
    }
  }, [])

  function selectOrder(order: ActiveOrder) {
    setSelectedOrder(order)
    setNomorMeja(order.nomorMeja)
    setError('')
    setSuccess('')
    setUangDiterima('')
    setShowBayarLangsung(false)
    setShowPreviewNota(false)
    resetIdempotencyKey()
  }

  function addToCart(menu: Menu) {
    if (isKasirClosed) return
    resetIdempotencyKey()
    setCart((prev) => {
      const current = prev.find((item) => item.menuId === menu.id)
      if (current) {
        return prev.map((item) =>
          item.menuId === menu.id ? { ...item, qty: item.qty + 1 } : item
        )
      }
      return [...prev, { menuId: menu.id, nama: menu.nama, harga: menu.harga, qty: 1, diskonSatuan: 0, catatan: '' }]
    })
  }

  function itemUnitPrice(item: CartItem) { return Math.max(0, (item.hargaSementara ?? item.harga) - item.diskonSatuan) }

  function resetIdempotencyKey() {
    setIdempotencyKey(createIdempotencyKey())
  }

  function saveCartItemEdit() {
    if (!editingCartItem) return
    if (editingCartItem.diskonSatuan > (editingCartItem.hargaSementara ?? editingCartItem.harga)) {
      setError('Diskon tidak boleh melebihi harga satuan.'); return
    }
    resetIdempotencyKey()
    setCart((prev) => prev.map((item) => item.menuId === editingCartItem.menuId ? editingCartItem : item))
    setEditingCartItem(null)
  }

  function updateQty(menuId: string, delta: number) {
    resetIdempotencyKey()
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.menuId === menuId) {
            const newQty = item.qty + delta
            return newQty > 0 ? { ...item, qty: newQty } : null
          }
          return item
        })
        .filter(Boolean) as CartItem[]
    )
  }

  function removeFromCart(menuId: string) {
    resetIdempotencyKey()
    setCart((prev) => prev.filter((item) => item.menuId !== menuId))
  }

  function resetOrderInput() {
    resetIdempotencyKey()
    setCart([])
    setNomorMeja('')
    setSelectedOrder(null)
    setError('')
    setSuccess('')
    setUangDiterima('')
    setShowBayarLangsung(false)
    setShowPreviewNota(false)
    setBayarLangsungUang('')
    setBayarLangsungError('')
  }

  const grandTotal = useMemo(() => cart.reduce((sum, item) => sum + itemUnitPrice(item) * item.qty, 0), [cart])
  const totalItemCount = useMemo(() => cart.reduce((sum, item) => sum + item.qty, 0), [cart])
  const selectedItemCount = useMemo(() => selectedOrder?.items.reduce((sum, item) => sum + item.qty, 0) || 0, [selectedOrder])
  const bayarLangsungTotal = grandTotal + (selectedOrder?.total ?? 0)
  const bayarLangsungQuickAmounts = useMemo(() => generateQuickAmounts(bayarLangsungTotal), [bayarLangsungTotal])
  const bayarLangsungKembalian = useMemo(() => {
    if (bayarLangsungMetode !== 'CASH' || bayarLangsungUang === '' || bayarLangsungUang < 0) return null
    return hitungKembalian(bayarLangsungUang, bayarLangsungTotal)
  }, [bayarLangsungMetode, bayarLangsungUang, bayarLangsungTotal])

  async function handleCheckout() {
    setError('')
    setSuccess('')
    if (isKasirClosed) { setError('Buka kasir terlebih dahulu.'); return }
    if (!nomorMeja.trim()) { setError('Harap masukkan nomor meja atau pilih dari tombol meja.'); return }
    if (cart.length === 0) { setError('Keranjang pesanan masih kosong. Pilih menu di sebelah kiri.'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/transaksi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomorMeja: nomorMeja.trim(),
          items: cart.map((item) => ({ menuId: item.menuId, qty: item.qty, hargaSatuan: item.hargaSementara ?? item.harga, diskonSatuan: item.diskonSatuan, catatan: item.catatan })),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSelectedOrder(data.data)
        setSuccess('Order sementara tersimpan. Cetak struk dilakukan saat pembayaran final.')
        resetIdempotencyKey()
        setCart([])
        await loadActiveOrders()
      } else {
        setError(data.message || 'Gagal menyimpan transaksi.')
      }
    } catch {
      setError('Koneksi internet bermasalah. Gagal menyimpan transaksi.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePrintTransaction(transaksi: CompletedTransaksi, payment: ReceiptPaymentMeta | null) {
    setPrinting(true)
    try {
      const encoded = await encodeReceipt({
        transaction: transaksi,
        cashier: session.namaLengkap || session.username,
        username: session.username,
        warungKode: session.warungKode,
        warungNama: session.warungNama,
        warungAlamat: session.warungAlamat,
        width: printerWidth,
        uangDiterima: payment?.uangDiterima,
        kembalian: payment?.kembalian
      })

      const jobId = `${transaksi.id}-${printJobSeq.current++}`
      const result = await printer.printReceipt(encoded, jobId)
      const ok = typeof result === 'boolean' ? result : result.ok
      if (!ok) {
        setError(typeof result === 'boolean' ? printer.error || 'Gagal mencetak ke printer thermal' : `${result.error || 'Gagal mencetak'} (${result.status})`)
      } else {
        setSuccess('Struk terkirim ke printer')
      }
      return ok
    } catch (e) {
      console.error('Print error:', e)
      setError(`Gagal mencetak: ${e instanceof Error ? e.message : 'Unknown error'}`)
      return false
    } finally {
      setPrinting(false)
    }
  }

  async function handlePrintReceipt() {
    if (!completedTransaksi) return
    await handlePrintTransaction(completedTransaksi, receiptPayment)
  }

  async function handleUpdateSavedItem(itemId: string, qty: number) {
    if (qty < 1) return
    setError('')
    const res = await fetch(`/api/transaksi/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty }),
    })
    const data = await res.json()
    if (data.success) { setSelectedOrder(data.data); await loadActiveOrders() }
    else { setError(data.message || 'Gagal mengubah item order.') }
  }

  async function handleDeleteSavedItem(itemId: string) {
    setError('')
    const res = await fetch(`/api/transaksi/items/${itemId}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) { setSelectedOrder(data.data); await loadActiveOrders() }
    else { setError(data.message || 'Gagal menghapus item order.') }
  }

  async function handleDeleteOrder(orderId: string) {
    if (!confirm('Hapus pesanan ini?')) return
    setError('')
    const res = await fetch(`/api/transaksi/${orderId}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) {
      if (selectedOrder?.id === orderId) { setSelectedOrder(null); setNomorMeja(''); resetIdempotencyKey() }
      await loadActiveOrders()
    } else {
      setError(data.message || 'Gagal menghapus pesanan.')
    }
  }

  function openBayarLangsung() {
    setError('')
    setSuccess('')
    if (isKasirClosed) { setError('Buka kasir terlebih dahulu.'); return }
    if (!nomorMeja.trim()) { setError('Harap masukkan nomor meja atau pilih dari tombol meja.'); return }
    if (cart.length === 0 && !selectedOrder) { setError('Keranjang pesanan masih kosong. Pilih menu di sebelah kiri.'); return }
    setBayarLangsungMetode('CASH')
    setBayarLangsungUang('')
    setBayarLangsungError('')
    setShowBayarLangsung(true)
  }

  function closePreviewNota() {
    setShowPreviewNota(false)
    setPreviewError('')
    setPreviewData(null)
  }

  async function openPreviewNota() {
    setError('')
    setSuccess('')
    setPreviewError('')
    if (isKasirClosed) { setError('Buka kasir terlebih dahulu.'); return }
    if (!nomorMeja.trim()) { setError('Harap masukkan nomor meja atau pilih dari tombol meja.'); return }
    if (cart.length === 0 && !selectedOrder) { setError('Keranjang pesanan masih kosong. Pilih menu di sebelah kiri.'); return }

    setPreviewData(null)
    setShowPreviewNota(true)
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/transaksi/preview-nota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomorMeja: nomorMeja.trim(),
          orderId: selectedOrder?.id,
          items: cart.map((item) => ({
            menuId: item.menuId,
            qty: item.qty,
            hargaSatuan: item.hargaSementara ?? item.harga,
            diskonSatuan: item.diskonSatuan,
            catatan: item.catatan,
          })),
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setPreviewError(data.message || 'Gagal memuat preview nota.')
        return
      }
      setPreviewData(data.data)
    } catch {
      setPreviewError('Koneksi internet bermasalah. Gagal memuat preview nota.')
    } finally {
      setPreviewLoading(false)
    }
  }

  function handlePreviewPay() {
    setShowPreviewNota(false)
    setPreviewError('')
    openBayarLangsung()
  }

  function handlePreviewSave() {
    if (cart.length === 0) return
    setShowPreviewNota(false)
    setPreviewError('')
    void handleCheckout()
  }

  async function handleBayarLangsung() {
    if (isKasirClosed) { setBayarLangsungError('Buka kasir terlebih dahulu.'); return }
    if (!nomorMeja.trim()) { setBayarLangsungError('Harap masukkan nomor meja atau pilih dari tombol meja.'); return }
    if (cart.length === 0 && !selectedOrder) { setBayarLangsungError('Keranjang pesanan masih kosong.'); return }
    if (bayarLangsungMetode === 'CASH') {
      if (bayarLangsungUang === '') { setBayarLangsungError('Masukkan uang yang diterima.'); return }
      if (bayarLangsungKembalian && !bayarLangsungKembalian.isValid) {
        setBayarLangsungError(bayarLangsungKembalian.message)
        return
      }
    }

    setPaying(true)
    setBayarLangsungError('')
    setError('')
    setSuccess('')
    try {
      const body: Record<string, unknown> = {
        nomorMeja: nomorMeja.trim(),
        orderId: selectedOrder?.id,
        idempotencyKey,
        metodePembayaran: bayarLangsungMetode,
        items: cart.map((item) => ({
          menuId: item.menuId,
          qty: item.qty,
          hargaSatuan: item.hargaSementara ?? item.harga,
          diskonSatuan: item.diskonSatuan,
          catatan: item.catatan,
        })),
      }
      if (bayarLangsungMetode === 'CASH') {
        body.uangDiterima = bayarLangsungUang
      }

      const res = await fetch('/api/transaksi/bayar-langsung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) {
        setBayarLangsungError(data.message || 'Gagal memproses pembayaran.')
        return
      }

      const payment = data.meta?.cash
        ? { uangDiterima: Number(data.meta.cash.uangDiterima), kembalian: Number(data.meta.cash.kembalian) }
        : null

      setReceiptPayment(payment)
      setCompletedTransaksi(data.data)
      setShowBayarLangsung(false)
      setShowPreviewNota(false)
      setShowReceiptModal(true)
      resetIdempotencyKey()
      setCart([])
      setNomorMeja('')
      setSelectedOrder(null)
      setUangDiterima('')
      setKembalianResult(null)
      setError('')
      setSuccess('')
      await loadActiveOrders()

      const printed = await handlePrintTransaction(data.data, payment)
      if (!printed) {
        setError('Dibayar, struk gagal dicetak. Periksa printer lalu klik Cetak Struk.')
      } else {
        setSuccess('Pembayaran berhasil dan struk terkirim ke printer.')
      }
    } catch {
      setBayarLangsungError('Koneksi internet bermasalah. Gagal memproses pembayaran.')
    } finally {
      setPaying(false)
    }
  }

  async function handlePayOrder() {
    if (!selectedOrder) return
    if (cart.length > 0) { setError('Simpan tambahan item dulu sebelum bayar.'); return }
    if (metodePembayaran === 'CASH' && kembalianResult && !kembalianResult.isValid) {
      setError(kembalianResult.message)
      return
    }
    setError('')
    setSuccess('')
    setPaying(true)
    try {
      const body: Record<string, unknown> = { metodePembayaran }
      if (metodePembayaran === 'CASH' && typeof uangDiterima === 'number') {
        body.uangDiterima = uangDiterima
        body.kembalian = kembalianResult?.kembalian ?? 0
      }
      const res = await fetch(`/api/transaksi/${selectedOrder.id}/bayar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setReceiptPayment(
          metodePembayaran === 'CASH' && typeof uangDiterima === 'number'
            ? { uangDiterima, kembalian: kembalianResult?.kembalian ?? 0 }
            : null
        )
        setCompletedTransaksi(data.data)
        setShowReceiptModal(true)
        resetOrderInput()
        await loadActiveOrders()
      } else {
        setError(data.message || 'Gagal memproses pembayaran.')
      }
    } catch {
      setError('Koneksi internet bermasalah. Gagal memproses pembayaran.')
    } finally {
      setPaying(false)
    }
  }

  function handleNewOrder() {
    setShowReceiptModal(false)
    setCompletedTransaksi(null)
    setReceiptPayment(null)
    setError('')
    setSuccess('')
  }

  return (
    <div>
      {isKasirClosed && (
        <div className="alert alert-warning no-print" style={{ marginBottom: '1.25rem' }}>
          <div>
            <strong>Kasir Belum Dibuka</strong>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Buka kasir terlebih dahulu sebelum membuat transaksi.
              Anda dapat membukanya di menu{' '}
              <Link href="/kasir" style={{ textDecoration: 'underline', color: 'inherit', fontWeight: 600 }}>
                Manajemen Kasir
              </Link>.
            </p>
          </div>
        </div>
      )}

      {!isKasirClosed && isShiftOvertime && (
        <div className="alert alert-error no-print" style={{ marginBottom: '1.25rem' }}>
          <div>
            <strong>Peringatan: shift sudah berjalan lebih dari 18 jam</strong>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              Segera tutup shift setelah pesanan selesai. Owner dapat menutup paksa shift dengan catatan.
            </p>
          </div>
        </div>
      )}

      {/* Meja Aktif */}
      <div className="card no-print" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', margin: 0 }}>Meja Aktif</h2>
          <button onClick={() => window.location.reload()} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
            Refresh
          </button>
        </div>
        {activeOrders.length === 0 ? (
          <p className="text-secondary" style={{ margin: 0, fontSize: '0.875rem' }}>Belum ada order sementara.</p>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {activeOrders.map((order) => {
              const count = order.items.reduce((sum, item) => sum + item.qty, 0)
              return (
                <div key={order.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <button
                    type="button"
                    onClick={() => selectOrder(order)}
                    className={`btn btn-sm ${selectedOrder?.id === order.id ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {order.nomorMeja} · {count} item · Rp {order.total.toLocaleString('id-ID')} · {order.minutesOpen}m
                  </button>
                  {session.role === 'OWNER' && (
                    <button
                      type="button"
                      onClick={() => handleDeleteOrder(order.id)}
                      className="btn btn-sm btn-danger"
                      style={{ padding: '4px', minWidth: 'auto' }}
                      title="Hapus pesanan"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* POS Two-Column Grid */}
      <div className="no-print pos-grid">
        {/* KOLOM KIRI: MENU PICKER */}
        <div>
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Menu Utama</h2>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>{menus.length} menu</span>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Cari menu (cth: Kepiting, Cumi, Jeruk)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', paddingLeft: '36px' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <button type="button" onClick={() => { setActiveCategoryId(null); document.getElementById('menu-list')?.scrollIntoView({ behavior: 'smooth' }) }}
                className={`btn btn-sm ${activeCategoryId === null ? 'btn-primary' : 'btn-ghost'}`}>
                Semua ({menus.filter((m) => m.isAktif).length})
              </button>
              {categories.map((cat) => (
                <button key={cat.id} type="button"
                  onClick={() => { setActiveCategoryId(cat.id); document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: 'smooth' }) }}
                  className={`btn btn-sm ${activeCategoryId === cat.id ? 'btn-primary' : 'btn-ghost'}`}>
                  {cat.nama} ({cat.count})
                </button>
              ))}
            </div>
          </div>

          <div id="menu-list">
          {filteredMenus.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <ShoppingCart size={40} style={{ color: 'var(--color-text-muted)', marginBottom: '0.5rem' }} />
              {menus.length === 0 ? (
                <>
                  <p className="text-secondary" style={{ marginBottom: '0.75rem' }}>Belum ada menu. Minta owner sync menu dulu.</p>
                  <button onClick={() => window.location.reload()} className="btn btn-primary btn-sm">Refresh Halaman</button>
                </>
              ) : (
                <p className="text-secondary">Tidak ada menu yang cocok dengan filter saat ini.</p>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {Array.from(menusByCategory.entries()).map(([catId, catMenus]) => (
                <div key={catId} id={`cat-${catId}`}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.6rem', color: 'var(--color-text-primary)' }}>
                    {catMenus[0]?.category.nama}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    {catMenus.map((menu) => {
                      const inCart = cartByMenuId.get(menu.id)
                      return (
                        <div
                          key={menu.id}
                          onClick={() => addToCart(menu)}
                          className="card"
                          style={{
                            padding: '1rem',
                            cursor: isKasirClosed ? 'not-allowed' : 'pointer',
                            border: inCart ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                            background: inCart ? 'var(--color-brand-soft)' : 'var(--color-surface)',
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'var(--transition)',
                            opacity: isKasirClosed ? 0.6 : 1,
                            userSelect: 'none',
                          }}
                        >
                          {inCart && (
                            <span style={{
                              position: 'absolute', top: '8px', right: '8px',
                              background: 'var(--color-brand)', color: '#fff',
                              fontWeight: 700, fontSize: '0.75rem', borderRadius: '12px',
                              padding: '0.15rem 0.5rem', boxShadow: 'var(--shadow-sm)',
                            }}>
                              {inCart.qty}x
                            </span>
                          )}
                          <div style={{
                            fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-primary)',
                            lineHeight: '1.3', marginBottom: '0.5rem',
                          }}>
                            {menu.nama}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                            <span style={{
                              fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-primary)',
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              Rp {menu.harga.toLocaleString('id-ID')}
                            </span>
                            <button
                              type="button"
                              disabled={isKasirClosed}
                              style={{
                                width: '28px', height: '28px', borderRadius: '50%', border: 'none',
                                background: inCart ? 'var(--color-brand)' : 'var(--color-surface-raised)',
                                color: inCart ? '#fff' : 'var(--color-text-primary)',
                                fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: isKasirClosed ? 'not-allowed' : 'pointer',
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* KOLOM KANAN: CART / ORDER SUMMARY */}
        <div className="card" style={{ position: 'sticky', top: '80px', padding: '1.25rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border)' }}>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>
              Pesanan ({selectedItemCount + totalItemCount} item)
            </h2>
            {cart.length > 0 && (
              <button type="button" onClick={resetOrderInput} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                <X size={14} /> Reset
              </button>
            )}
          </div>

          {/* Nomor Meja */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-text-primary)' }}>
              Nomor Meja <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Ketik nomor meja atau klik tombol di bawah..."
              value={nomorMeja}
              onChange={(e) => { setNomorMeja(e.target.value); resetIdempotencyKey() }}
              style={{ marginBottom: '0.5rem', width: '100%' }}
              disabled={isKasirClosed}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: '0.35rem' }}>
              {quickTables.map((table) => table === TABLE_SECTION_GAP ? (
                <div key={table} style={{ gridColumn: '1 / -1', height: '0.75rem' }} aria-hidden="true" />
              ) : (
                <button
                  key={table}
                  type="button"
                  onClick={() => {
                    const order = activeOrders.find((active) => active.nomorMeja === table)
                    if (order) selectOrder(order)
                    else { setSelectedOrder(null); setNomorMeja(table); resetIdempotencyKey() }
                  }}
                  disabled={isKasirClosed}
                  className="btn btn-ghost btn-sm"
                  style={{
                    fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
                    background: nomorMeja === table ? 'var(--color-brand)' : 'var(--color-surface-raised)',
                    color: nomorMeja === table ? '#fff' : 'var(--color-text-secondary)',
                  }}
                >
                  {table}
                </button>
              ))}
            </div>
          </div>

          {/* Selected Order */}
          {selectedOrder && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Order tersimpan: {selectedOrder.nomorMeja}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {selectedOrder.items.map((item) => (
                  <div key={item.id} style={{ padding: '0.65rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{item.namaMenu}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                        Rp {item.hargaSatuan.toLocaleString('id-ID')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <button type="button" className="btn btn-ghost btn-sm qty-stepper" onClick={() => item.id && handleUpdateSavedItem(item.id, item.qty - 1)}><Minus size={14} /></button>
                      <strong>{item.qty}</strong>
                      <button type="button" className="btn btn-ghost btn-sm qty-stepper" onClick={() => item.id && handleUpdateSavedItem(item.id, item.qty + 1)}><Plus size={14} /></button>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: '75px' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>Rp {item.subtotal.toLocaleString('id-ID')}</div>
                      <button type="button" onClick={() => item.id && handleDeleteSavedItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cart Items */}
          <div style={{ maxHeight: '340px', overflowY: 'auto', marginBottom: '1rem', paddingRight: '4px' }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-muted)' }}>
                <ShoppingCart size={32} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                <p style={{ margin: 0, fontSize: '0.875rem' }}>Belum ada item pesanan.</p>
                <span style={{ fontSize: '0.75rem' }}>Klik menu di sebelah kiri untuk menambahkan.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {cart.map((item) => (
                  <div key={item.menuId} style={{ padding: '0.75rem', background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.nama}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        Rp {itemUnitPrice(item).toLocaleString('id-ID')}{item.diskonSatuan > 0 && ` (diskon Rp ${item.diskonSatuan.toLocaleString('id-ID')})`}
                      </div>
                      {item.catatan && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{item.catatan}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <button type="button" onClick={() => updateQty(item.menuId, -1)} className="btn btn-ghost btn-sm qty-stepper">
                        <Minus size={14} />
                      </button>
                      <button type="button" ref={(el) => { if (el) qtyBtnRefs.current.set(item.menuId, el) }} onClick={(e) => { e.stopPropagation(); if (qtyPickerMenuId === item.menuId) { setQtyPickerMenuId(null) } else { const btn = qtyBtnRefs.current.get(item.menuId); if (btn) { const r = btn.getBoundingClientRect(); const above = r.top > Math.min(420, window.innerHeight * 0.6); setQtyPickerPlacement(above ? 'above' : 'below'); setQtyPickerPos({ top: above ? r.top - 4 : r.bottom + 4, left: r.left + r.width / 2 }); setQtyPickerMenuId(item.menuId) } } }} style={{ minWidth: '28px', minHeight: '28px', textAlign: 'center', fontWeight: 700, fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums', background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '2px 6px', color: 'var(--color-text-primary)' }}>
                        {item.qty}
                      </button>
                      <button type="button" onClick={() => updateQty(item.menuId, 1)} className="btn btn-ghost btn-sm qty-stepper">
                        <Plus size={14} />
                      </button>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: '70px' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        Rp {(itemUnitPrice(item) * item.qty).toLocaleString('id-ID')}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
                        <button type="button" onClick={() => setEditingCartItem(item)} style={{ background: 'none', border: 'none', color: 'var(--color-brand)', cursor: 'pointer', padding: '6px', minWidth: '42px', minHeight: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)' }} title="Atur harga, diskon, atau catatan"><Pencil size={24} /></button>
                        <button type="button" onClick={() => removeFromCart(item.menuId)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>Hapus</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Grand Total */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Total Tambahan:</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-text-primary)', fontFamily: "var(--font-fraunces), serif", fontVariantNumeric: 'tabular-nums' }}>
                Rp {grandTotal.toLocaleString('id-ID')}
              </span>
            </div>
            <button
              type="button"
              id="btn-preview-nota"
              onClick={openPreviewNota}
              disabled={isKasirClosed || paying || submitting || (cart.length === 0 && !selectedOrder)}
              className="btn btn-ghost"
              style={{ width: '100%', minHeight: '48px', justifyContent: 'center', gap: '0.5rem', fontWeight: 700, border: '1px solid var(--color-border)' }}
            >
              <Eye size={18} /> Preview Nota
            </button>
          </div>

          {error && (
            <div className="alert alert-error" style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {success && (
            <div className="alert alert-success" style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
              {success}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: '0.75rem' }}>
              <button
                type="button"
                id="btn-bayar-langsung"
                onClick={openBayarLangsung}
                disabled={isKasirClosed || paying || submitting || (cart.length === 0 && !selectedOrder)}
                className="btn btn-primary"
                style={{ minHeight: '52px', padding: '0.875rem', fontSize: '1rem', fontWeight: 800, justifyContent: 'center' }}
              >
                {paying ? 'Memproses...' : 'BAYAR'}
              </button>
              <button
                type="button"
                id="btn-simpan-transaksi"
                onClick={handleCheckout}
                disabled={isKasirClosed || submitting || paying || cart.length === 0}
                className="btn btn-ghost"
                style={{ minHeight: '52px', padding: '0.875rem', fontSize: '0.95rem', fontWeight: 700, justifyContent: 'center', border: '1px solid var(--color-border)' }}
              >
                {submitting ? 'Menyimpan...' : 'SIMPAN'}
              </button>
            </div>

            {selectedOrder && (
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <strong>Total Order</strong>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>Rp {selectedOrder.total.toLocaleString('id-ID')}</strong>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {(['CASH', 'QRIS', 'TRANSFER'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setMetodePembayaran(method)}
                      className={`btn btn-sm ${metodePembayaran === method ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      {method === 'CASH' ? <Banknote size={14} /> : method === 'QRIS' ? <CreditCard size={14} /> : <CreditCard size={14} />}
                      {method}
                    </button>
                  ))}
                </div>

                {metodePembayaran === 'CASH' && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                      Uang Diterima
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      placeholder="Masukkan jumlah uang"
                      value={uangDiterima}
                      onChange={(e) => {
                        const val = e.target.value
                        setUangDiterima(val === '' ? '' : Number(val))
                      }}
                      className="form-input"
                      style={{ fontSize: '1.25rem', padding: '0.75rem', width: '100%', fontWeight: 700 }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {quickAmounts.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => setUangDiterima(amount)}
                          className={`btn btn-sm ${uangDiterima === amount ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                        >
                          {amount === selectedOrder.total ? 'Uang Pas' : `Rp ${amount.toLocaleString('id-ID')}`}
                        </button>
                      ))}
                    </div>
                    {kembalianResult && (
                      <div style={{
                        fontSize: '1.5rem',
                        fontWeight: 800,
                        color: kembalianResult.isValid ? 'var(--color-success)' : 'var(--color-danger)',
                        marginTop: '0.75rem',
                        textAlign: 'center',
                        fontFamily: 'var(--font-fraunces), serif'
                      }}>
                        {kembalianResult.message}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handlePayOrder}
                  disabled={paying || cart.length > 0 || selectedOrder.items.length === 0 || (metodePembayaran === 'CASH' && kembalianResult !== null && !kembalianResult.isValid)}
                  className="btn btn-success w-full"
                  style={{ justifyContent: 'center', fontWeight: 700 }}
                >
                  {paying ? 'Memproses...' : 'Konfirmasi & Cetak'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {qtyPickerMenuId && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', zIndex: 1100, background: 'var(--color-base)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '0.35rem', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: 'min(70vh, 420px)', overflowY: 'auto', transform: qtyPickerPlacement === 'above' ? 'translate(-50%, -100%)' : 'translateX(-50%)', top: qtyPickerPos.top + 'px', left: qtyPickerPos.left + 'px' }}>
          {[1,2,3,4,5,6,7,8,9,10].map((n) => (
            <button key={n} type="button" onClick={() => { resetIdempotencyKey(); setCart((prev) => prev.map((ci) => ci.menuId === qtyPickerMenuId ? { ...ci, qty: n } : ci)); setQtyPickerMenuId(null) }} style={{ minWidth: '44px', minHeight: '38px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', textAlign: 'center' }}>
              {n}
            </button>
          ))}
        </div>
      )}

      {editingCartItem && (
        <div className="modal-overlay no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(51, 51, 51, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000 }} onClick={(event) => { if (event.target === event.currentTarget) setEditingCartItem(null) }}>
          <div className="item-edit-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontFamily: 'inherit', fontSize: '1.15rem', margin: 0 }}>EDIT PESANAN</h2>
              <button type="button" onClick={() => setEditingCartItem(null)} className="btn btn-ghost btn-sm" style={{ padding: '4px' }}><X size={18} /></button>
            </div>
            <div className="item-edit-summary"><div className="item-edit-avatar">{editingCartItem.nama.slice(0, 2).toUpperCase()}</div><div style={{ flex: 1 }}><strong>{editingCartItem.nama}</strong><p>Harga menu: Rp {editingCartItem.harga.toLocaleString('id-ID')}</p></div><strong>Rp {(itemUnitPrice(editingCartItem) * editingCartItem.qty).toLocaleString('id-ID')}</strong></div>
            <div className="item-edit-stepper"><button type="button" onClick={() => setEditingCartItem({ ...editingCartItem, qty: Math.max(1, editingCartItem.qty - 1) })}>−</button><strong>{editingCartItem.qty}</strong><button type="button" onClick={() => setEditingCartItem({ ...editingCartItem, qty: editingCartItem.qty + 1 })}>+</button></div>
            <label className="item-edit-option"><input type="checkbox" checked={editingCartItem.hargaSementara !== undefined} onChange={(event) => setEditingCartItem({ ...editingCartItem, hargaSementara: event.target.checked ? editingCartItem.harga : undefined })} /> Ubah harga sementara</label>
            {editingCartItem.hargaSementara !== undefined && <input type="number" min="0" step="500" className="form-input" value={editingCartItem.hargaSementara} onChange={(event) => setEditingCartItem({ ...editingCartItem, hargaSementara: Number(event.target.value) })} aria-label="Harga sementara" />}
            <label className="item-edit-option"><input type="checkbox" checked={editingCartItem.diskonSatuan > 0} onChange={(event) => setEditingCartItem({ ...editingCartItem, diskonSatuan: event.target.checked ? 500 : 0 })} /> Ubah diskon per jumlah</label>
            {editingCartItem.diskonSatuan > 0 && <input type="number" min="0" step="500" className="form-input" value={editingCartItem.diskonSatuan} onChange={(event) => setEditingCartItem({ ...editingCartItem, diskonSatuan: Number(event.target.value) })} aria-label="Diskon per jumlah" />}
            <label className="item-edit-option"><input type="checkbox" checked={Boolean(editingCartItem.catatan)} onChange={(event) => setEditingCartItem({ ...editingCartItem, catatan: event.target.checked ? ' ' : '' })} /> Tambah catatan singkat</label>
            {editingCartItem.catatan && <input type="text" maxLength={160} className="form-input" placeholder="Contoh: pilih yang besar" value={editingCartItem.catatan} onChange={(event) => setEditingCartItem({ ...editingCartItem, catatan: event.target.value })} />}
            <button type="button" onClick={saveCartItemEdit} className="btn btn-primary item-edit-save">SIMPAN</button>
          </div>
        </div>
      )}

      {showPreviewNota && (
        <div
          className="modal-overlay no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-nota-title"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000 }}
          onClick={(event) => { if (event.target === event.currentTarget && !previewLoading && !paying && !submitting) closePreviewNota() }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '480px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: '1.25rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexShrink: 0 }}>
              <div>
                <h2 id="preview-nota-title" style={{ fontSize: '1.15rem', margin: 0 }}>Preview Nota</h2>
                <p className="text-secondary" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>Belum dibayar.</p>
              </div>
              <button
                type="button"
                onClick={closePreviewNota}
                disabled={previewLoading || paying || submitting}
                className="btn btn-ghost"
                style={{ minWidth: '44px', minHeight: '44px', padding: 0, justifyContent: 'center' }}
                aria-label="Tutup preview nota"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.75rem' }}>
              {previewLoading && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-secondary)' }}>
                  Memuat preview nota...
                </div>
              )}
              {!previewLoading && previewError && (
                <div className="alert alert-error" role="alert" style={{ fontSize: '0.9rem' }}>
                  {previewError}
                </div>
              )}
              {!previewLoading && previewData && (
                <NotaPreview
                  branchName={previewData.warungNama || session.warungNama}
                  nomorMeja={previewData.nomorMeja}
                  createdAt={previewData.generatedAt}
                  items={previewData.items}
                  total={previewData.total}
                  label="PREVIEW / BELUM DIBAYAR"
                />
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', flexShrink: 0 }}>
              <button type="button" onClick={closePreviewNota} disabled={previewLoading || paying || submitting} className="btn btn-ghost" style={{ minHeight: '48px', justifyContent: 'center' }}>
                Kembali
              </button>
              <button type="button" onClick={handlePreviewPay} disabled={!previewData || paying || submitting} className="btn btn-primary" style={{ minHeight: '48px', justifyContent: 'center', fontWeight: 800 }}>
                BAYAR
              </button>
              <button type="button" onClick={handlePreviewSave} disabled={!previewData || cart.length === 0 || submitting || paying} className="btn btn-ghost" style={{ minHeight: '48px', justifyContent: 'center', fontWeight: 800, border: '1px solid var(--color-border)' }}>
                {submitting ? 'Menyimpan...' : 'SIMPAN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBayarLangsung && (
        <div
          className="modal-overlay no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bayar-langsung-title"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000 }}
          onClick={(event) => { if (event.target === event.currentTarget && !paying) setShowBayarLangsung(false) }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '440px', maxHeight: '92vh', overflowY: 'auto', padding: '1.25rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 id="bayar-langsung-title" style={{ fontSize: '1.15rem', margin: 0 }}>Pembayaran Langsung</h2>
                <p className="text-secondary" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Meja {nomorMeja}</p>
              </div>
              <button type="button" onClick={() => setShowBayarLangsung(false)} disabled={paying} className="btn btn-ghost" style={{ minWidth: '44px', minHeight: '44px', padding: 0, justifyContent: 'center' }} aria-label="Tutup">
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '0.875rem', background: 'var(--color-accent-soft)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Total</span>
                <strong style={{ fontSize: '1.35rem', fontFamily: 'var(--font-fraunces), serif', fontVariantNumeric: 'tabular-nums' }}>Rp {bayarLangsungTotal.toLocaleString('id-ID')}</strong>
              </div>
              {selectedOrder && (
                <p className="text-secondary" style={{ margin: '0.35rem 0 0', fontSize: '0.75rem' }}>
                  Termasuk order tersimpan Rp {selectedOrder.total.toLocaleString('id-ID')}
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
              {(['CASH', 'QRIS', 'TRANSFER'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => { setBayarLangsungMetode(method); setBayarLangsungError('') }}
                  className={`btn ${bayarLangsungMetode === method ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minHeight: '48px', justifyContent: 'center', padding: '0.5rem' }}
                >
                  {method === 'CASH' ? <Banknote size={16} /> : <CreditCard size={16} />}
                  {method}
                </button>
              ))}
            </div>

            {bayarLangsungMetode === 'CASH' && (
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="bayar-langsung-uang" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                  Uang Diterima
                </label>
                <input
                  id="bayar-langsung-uang"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="500"
                  placeholder="Masukkan jumlah uang"
                  value={bayarLangsungUang}
                  onChange={(event) => setBayarLangsungUang(event.target.value === '' ? '' : Number(event.target.value))}
                  className="form-input"
                  style={{ fontSize: '1.25rem', padding: '0.75rem', width: '100%', fontWeight: 700, minHeight: '48px' }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {bayarLangsungQuickAmounts.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setBayarLangsungUang(amount)}
                      className={`btn btn-sm ${bayarLangsungUang === amount ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ minHeight: '40px', fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                    >
                      {amount === bayarLangsungTotal ? 'Uang Pas' : `Rp ${amount.toLocaleString('id-ID')}`}
                    </button>
                  ))}
                </div>
                {bayarLangsungKembalian && (
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: bayarLangsungKembalian.isValid ? 'var(--color-success)' : 'var(--color-danger)', marginTop: '0.75rem', textAlign: 'center' }}>
                    {bayarLangsungKembalian.message}
                  </div>
                )}
              </div>
            )}

            {bayarLangsungError && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
                {bayarLangsungError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0.75rem' }}>
              <button type="button" onClick={() => setShowBayarLangsung(false)} disabled={paying} className="btn btn-ghost" style={{ minHeight: '48px', justifyContent: 'center' }}>
                Batal
              </button>
              <button
                type="button"
                onClick={handleBayarLangsung}
                disabled={paying || (bayarLangsungMetode === 'CASH' && (!bayarLangsungKembalian || !bayarLangsungKembalian.isValid))}
                className="btn btn-success"
                style={{ minHeight: '48px', justifyContent: 'center', fontWeight: 800 }}
              >
                {paying ? 'Memproses...' : 'Bayar & Cetak'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL STRUK */}
      {showReceiptModal && completedTransaksi && (
        <div className="modal-overlay no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000, animation: 'fadeIn 0.2s ease-out' }}>
          <div className="card" style={{ width: '100%', maxWidth: '420px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: '1.5rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', animation: 'scaleIn 0.2s ease-out' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem', flexShrink: 0 }}>
              <CheckCircle size={40} style={{ color: 'var(--color-success)', marginBottom: '0.5rem' }} />
              <h3 style={{ fontSize: '1.25rem', margin: 0 }}>Transaksi Berhasil!</h3>
              <p className="text-secondary text-xs">
                Transaksi telah tercatat di sistem. Silakan cetak struk untuk pelanggan.
              </p>
            </div>

            {/* The D4-504 screen is short, so the preview scrolls and the buttons stay pinned. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <Receipt transaction={completedTransaksi} cashier={session.namaLengkap || session.username} username={session.username} warungKode={session.warungKode} warungNama={session.warungNama} warungAlamat={session.warungAlamat} width={printerWidth} preview uangDiterima={receiptPayment?.uangDiterima} kembalian={receiptPayment?.kembalian} />
              <div className="receipt-width-picker">
                <span>Ukuran printer</span>
                {(['58mm', '80mm'] as const).map((width) => <button key={width} type="button" onClick={() => setPrinterWidth(width)} className={`btn btn-sm ${printerWidth === width ? 'btn-primary' : 'btn-ghost'}`}>{width}</button>)}
                <PrinterStatusBadge onSetupClick={() => setShowPrinterSetup(true)} />
              </div>

              {/* Instruksi cetak untuk Android */}
              <div style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: 'var(--color-text-primary)' }}>Cara cetak dari Android:</strong>
                <ol style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, lineHeight: 1.6 }}>
                  <li>Klik <strong>Cetak Struk</strong></li>
                  <li>Pilih printer <strong>Blueprint</strong></li>
                  <li>Tap <strong>&quot;Kertas&quot;</strong> → pilih <strong>&quot;Rol 58mm&quot;</strong> atau <strong>&quot;Rol 80mm&quot;</strong> jika ada</li>
                  <li>Jika tidak ada, pilih <strong>&quot;Lainnya&quot;</strong> → cari ukuran <strong>72mm</strong></li>
                  <li>Jika tidak bisa pilih, langsung klik <strong>Print</strong> saja</li>
                </ol>
              </div>

              {error && <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>{error}</div>}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexShrink: 0, paddingTop: '0.5rem' }}>
              <button type="button" onClick={handleNewOrder} className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
                Pesanan Baru
              </button>
              <button type="button" id="btn-cetak-struk" onClick={handlePrintReceipt} disabled={printing} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', fontWeight: 700 }}>
                <Printer size={16} /> {printing ? 'Mencetak...' : error ? 'Coba lagi' : 'Cetak Struk'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PrinterSetup open={showPrinterSetup} onClose={() => setShowPrinterSetup(false)} onConfigured={(config) => { if (config) setPrinterWidth(config.width) }} />

      {completedTransaksi && <Receipt transaction={completedTransaksi} cashier={session.namaLengkap || session.username} username={session.username} warungKode={session.warungKode} warungNama={session.warungNama} warungAlamat={session.warungAlamat} width={printerWidth} uangDiterima={receiptPayment?.uangDiterima} kembalian={receiptPayment?.kembalian} />}
    </div>
  )
}
