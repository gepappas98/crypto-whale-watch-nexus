import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Root-level error boundary. Catches render-time crashes from any descendant
 * (including components that throw before mount) and shows a recoverable
 * fallback instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always log so we can diagnose blank-page reports.
    console.error('[ErrorBoundary] render crash:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#0a0a0a',
            color: '#f5f5f5',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong.</h1>
            <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 16 }}>
              The app hit an unexpected error while rendering. You can try to recover without
              losing your session, or reload the page.
            </p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                background: '#161616',
                padding: 12,
                borderRadius: 6,
                marginBottom: 16,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {this.state.error.message}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={this.reset}
                style={{
                  padding: '8px 14px',
                  borderRadius: 6,
                  border: '1px solid #2dd4a8',
                  background: 'transparent',
                  color: '#2dd4a8',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 14px',
                  borderRadius: 6,
                  border: '1px solid #444',
                  background: 'transparent',
                  color: '#f5f5f5',
                  cursor: 'pointer',
                }}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
