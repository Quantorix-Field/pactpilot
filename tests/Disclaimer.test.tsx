import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Disclaimer } from '../src/components/Disclaimer'

describe('Disclaimer', () => {
  it('renders inside a footer landmark', () => {
    render(<Disclaimer />)
    expect(screen.getByRole('contentinfo').tagName).toBe('FOOTER')
  })

  it('states it is not legal advice', () => {
    render(<Disclaimer />)
    expect(screen.getByText(/does not give legal advice/i)).toBeInTheDocument()
  })

  it('tells the reader to confirm with a qualified lawyer', () => {
    render(<Disclaimer />)
    expect(screen.getByText(/qualified lawyer/i)).toBeInTheDocument()
  })
})
