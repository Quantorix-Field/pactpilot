import type { ReactElement } from 'react'

export function Hero(): ReactElement {
  return (
    <section className="hero" aria-label="About PactPilot">
      <p className="eyebrow reveal">§ Read before you sign</p>
      <h1 className="reveal" style={{ animationDelay: '0.08s' }}>
        Understand any contract, <em>before you sign it</em>
      </h1>
      <p className="reveal" style={{ animationDelay: '0.16s' }}>
        Paste a lease, offer letter, or freelance contract, or upload the PDF. PactPilot
        explains it in plain language and flags what could hurt you — and it can only point
        to a clause your own text actually contains.
      </p>
    </section>
  )
}
