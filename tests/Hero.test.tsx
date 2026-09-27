import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Hero } from '../src/components/Hero'

describe('Hero', () => {
  it('renders as a labelled section', () => {
    render(<Hero />)
    expect(screen.getByRole('region', { name: /about pactpilot/i })).toBeInTheDocument()
  })

  it('has a heading that promises what the product does', () => {
    render(<Hero />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/understand any contract/i)
    expect(heading).toHaveTextContent(/before you sign it/i)
  })

  it('explains both input methods: paste or upload', () => {
    render(<Hero />)
    expect(screen.getByText(/paste a lease/i)).toBeInTheDocument()
    expect(screen.getByText(/upload the pdf/i)).toBeInTheDocument()
  })
})
