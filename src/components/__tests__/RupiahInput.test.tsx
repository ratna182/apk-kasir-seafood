import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RupiahInput from '../RupiahInput'

afterEach(() => cleanup())

describe('RupiahInput', () => {
  test('menampilkan nilai dengan format Indonesia', () => {
    render(<RupiahInput value={50000} onValueChange={() => {}} ariaLabel="Uang diterima" />)
    const input = screen.getByLabelText('Uang diterima')
    expect(input).toHaveValue('50.000')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('type', 'text')
  })

  test('mengetik teks berformat memanggil nilai bulat', () => {
    const onValueChange = vi.fn()
    render(<RupiahInput value={''} onValueChange={onValueChange} ariaLabel="Uang diterima" />)
    const input = screen.getByLabelText('Uang diterima')
    fireEvent.change(input, { target: { value: 'Rp 50.000' } })
    expect(onValueChange).toHaveBeenLastCalledWith(50000)
  })

  test('mengetik koma ribuan memanggil 50000', () => {
    const onValueChange = vi.fn()
    render(<RupiahInput value={''} onValueChange={onValueChange} ariaLabel="Uang diterima" />)
    const input = screen.getByLabelText('Uang diterima')
    fireEvent.change(input, { target: { value: '50,000' } })
    expect(onValueChange).toHaveBeenLastCalledWith(50000)
  })

  test('mengosongkan input memanggil string kosong', () => {
    const onValueChange = vi.fn()
    render(<RupiahInput value={50000} onValueChange={onValueChange} ariaLabel="Uang diterima" />)
    const input = screen.getByLabelText('Uang diterima')
    fireEvent.change(input, { target: { value: '' } })
    expect(onValueChange).toHaveBeenLastCalledWith('')
  })
})
