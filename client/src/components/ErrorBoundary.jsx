import { Component } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

// A render throw used to give a white screen — no message, no navigation, and
// nothing in any log, because there is no error reporting on the client.
//
// Must be a class: getDerivedStateFromError and componentDidCatch have no
// hooks equivalent. Note this catches render, lifecycle and constructor
// errors only — event-handler and async failures already surface through the
// axios interceptor and the toast system.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  copyDetails = () => {
    const { error, info } = this.state;
    const text = [
      `Taxify error at ${window.location.pathname}`,
      String(error?.message || error),
      String(error?.stack || ''),
      String(info?.componentStack || ''),
    ]
      .filter(Boolean)
      .join('\n\n');
    // Best effort. If the clipboard is refused the text is on screen anyway,
    // which is the point of showing it.
    Promise.resolve(navigator.clipboard?.writeText(text))
      .then(() => this.setState({ copied: true }))
      .catch(() => {});
  };

  componentDidCatch(error, info) {
    // Kept so it can be shown and copied, not only posted. A card that says
    // "something went wrong" and nothing else leaves somebody with exactly as
    // much to report as a blank page did.
    this.setState({ info });

    // Best-effort, and deliberately not queued or retried: if this fails too,
    // the fallback below is still on screen, which is the part that matters.
    try {
      fetch('/api/app/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: String(error?.message || error).slice(0, 500),
          stack: String(error?.stack || '').slice(0, 2000),
          componentStack: String(info?.componentStack || '').slice(0, 2000),
          path: window.location.pathname,
        }),
      }).catch(() => {});
    } catch {
      // Nothing useful to do here.
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 460, padding: 28, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: 'var(--amber)' }}>
            <Icon name="alert" size={30} />
          </div>
          <h1 style={{ fontSize: 19, margin: '0 0 10px' }}>Something went wrong on this page</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
            Nothing you've recorded is affected — this is a display problem, not a data one. Reloading usually clears
            it.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            <Link to="/" className="btn btn-ghost" onClick={() => this.setState({ error: null })}>
              Back to dashboard
            </Link>
          </div>

          {/* The message itself, in production too.
              
              It used to be development-only, which meant the people who
              actually hit the error — on a phone, on the live site — had
              nothing to tell anyone, and the only copy was in a server log
              nobody was going to read. The bundle is public, so a stack trace
              gives away nothing that reading the JavaScript would not. */}
          <div style={{ marginTop: 22, textAlign: 'left' }}>
            <div
              style={{
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: 11.5,
                lineHeight: 1.5,
                color: 'var(--red)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                wordBreak: 'break-word',
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '5px 11px' }}
                onClick={this.copyDetails}
              >
                {this.state.copied ? 'Copied' : 'Copy details'}
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Send this over and it can be fixed properly.
              </span>
            </div>

            {(this.state.error?.stack || this.state.info?.componentStack) && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  Technical details
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    fontSize: 10.5,
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-muted)',
                    maxHeight: 220,
                    overflow: 'auto',
                  }}
                >
                  {String(this.state.error?.stack || '')}
                  {String(this.state.info?.componentStack || '')}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }
}
