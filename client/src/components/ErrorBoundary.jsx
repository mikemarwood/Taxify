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
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
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

          {import.meta.env.DEV && (
            <pre
              style={{
                marginTop: 20,
                textAlign: 'left',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                color: 'var(--red)',
                maxHeight: 220,
                overflow: 'auto',
              }}
            >
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
