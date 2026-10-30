'use client'

import type { CSSProperties } from 'react'
import { formatRupiah, formatRupiahInput } from '@/lib/rupiah'

interface RupiahInputProps {
  value: number | ''
  onValueChange: (value: number | '') => void
  id?: string
  name?: string
  placeholder?: string
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  disabled?: boolean
  required?: boolean
  autoFocus?: boolean
}

export default function RupiahInput({
  value,
  onValueChange,
  id,
  name,
  placeholder,
  className,
  style,
  ariaLabel,
  disabled,
  required,
  autoFocus,
}: RupiahInputProps) {
  const display = value === '' ? '' : formatRupiah(value)

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const result = formatRupiahInput(input.value, input.selectionStart ?? input.value.length)

    onValueChange(result.empty ? '' : result.value)

    requestAnimationFrame(() => {
      input.setSelectionRange(result.caret, result.caret)
    })
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      id={id}
      name={name}
      placeholder={placeholder}
      className={className}
      style={style}
      aria-label={ariaLabel}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      value={display}
      onChange={handleChange}
    />
  )
}
