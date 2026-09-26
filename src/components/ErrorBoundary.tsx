import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches rendering errors anywhere below it, so a bad AI response can never blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error.message, info.componentStack)
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="app" role="alert">
        <div
          className="panel stack"
          style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}
        >
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            PactPilot hit an unexpected error while showing this. Your document was not lost — try again.
          </p>
          <button type="button" className="btn btn--primary" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
