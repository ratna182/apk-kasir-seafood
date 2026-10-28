import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotaPreview from '../NotaPreview'

describe('NotaPreview', () => {
  it('renders the branch, table, item details, discount, note, and server total', () => {
    render(
      <NotaPreview
        branchName="Seafood Vian Jaya 08 (Kranggan)"
        nomorMeja="Meja 4"
        createdAt="2026-10-28T05:30:00.000Z"
        label="PREVIEW / BELUM DIBAYAR"
        items={[
          {
            namaMenu: 'Ikan Bakar',
            qty: 2,
            hargaSatuan: 25000,
            diskonSatuan: 2000,
            catatan: 'Tanpa sambal',
            subtotal: 46000,
          },
        ]}
        total={46000}
      />,
    )

    expect(screen.getByText('Cabang : Seafood Vian Jaya 08 (Kranggan)')).toBeInTheDocument()
    expect(screen.getByText('28/10/2026 12:30 WIB')).toBeInTheDocument()
    expect(screen.getByText('Meja 4')).toBeInTheDocument()
    expect(screen.getByText('PREVIEW / BELUM DIBAYAR')).toBeInTheDocument()
    expect(screen.getByText('Ikan Bakar')).toBeInTheDocument()
    expect(screen.getByText('2 x Rp 25.000')).toHaveTextContent('diskon Rp 2.000')
    expect(screen.getByText('Tanpa sambal')).toBeInTheDocument()
    expect(screen.getByText('TOTAL')).toBeInTheDocument()
    expect(screen.getAllByText('Rp 46.000')).toHaveLength(2)
  })

  it('falls back to the default branch when no branch name is supplied', () => {
    render(
      <NotaPreview
        branchName={null}
        nomorMeja="Bungkus"
        createdAt="2026-10-28T05:30:00.000Z"
        label="PREVIEW / BELUM DIBAYAR"
        items={[{ namaMenu: 'Nasi', qty: 1, hargaSatuan: 5000, subtotal: 5000 }]}
        total={5000}
      />,
    )

    expect(screen.getByText('Cabang : Seafood Vian Jaya 08 (Kranggan)')).toBeInTheDocument()
  })
})
