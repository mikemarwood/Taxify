import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import { playSuccess, playError, playClick } from '../lib/sounds.js';

// A year's archive can be hundreds of megabytes and takes real time to build,
// so the button reports what's happening rather than looking broken. The stages
// are honest: the server is genuinely gathering, then zipping, then the browser
// is genuinely downloading — the bar tracks bytes received once they start
// arriving, and shows indeterminate motion before that, because until the first
// byte lands there is nothing truthful to measure.
const STAGES = {
  idle: null,
  requesting: 'Requesting your year…',
  building: 'Gathering receipts and building the archive…',
  downloading: 'Downloading…',
  done: 'Saved to your downloads',
};

export default function YearArchiveButton({ financialYear, disabled }) {
  const toast = useToast();
  const [stage, setStage] = useState('idle');
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);

  const busy = stage !== 'idle' && stage !== 'done';

  async function download() {
    if (busy || !financialYear) return;
    playClick();
    setStage('requesting');
    setReceived(0);
    setTotal(0);

    try {
      const res = await fetch(`/api/export/year/${encodeURIComponent(financialYear)}.zip`, {
        credentials: 'include',
      });

      if (!res.ok) {
        // The failure body is JSON; the success body is a zip.
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `Could not build the archive (${res.status})`);
      }

      setStage('building');

      const length = Number(res.headers.get('Content-Length')) || 0;
      setTotal(length);

      // Read the stream so bytes can be counted. The server streams the zip as
      // it builds, so the first chunk arriving is the real "it's working".
      const reader = res.body.getReader();
      const chunks = [];
      let count = 0;
      let started = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!started) {
          started = true;
          setStage('downloading');
        }
        chunks.push(value);
        count += value.length;
        setReceived(count);
      }

      const blob = new Blob(chunks, { type: 'application/zip' });
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `Taxify ${financialYear}.zip`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      playSuccess();
      setStage('done');
      setTimeout(() => setStage('idle'), 4000);
    } catch (err) {
      playError();
      setStage('idle');
      toast(err.message, 'error');
    }
  }

  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const mb = (received / (1024 * 1024)).toFixed(1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 260 }}>
      <motion.button
        type="button"
        className="btn btn-ghost"
        onClick={download}
        disabled={busy || disabled}
        whileHover={!busy && !disabled ? { y: -1 } : undefined}
        style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        {busy ? <span className="spinner" /> : <Icon name="download" size={15} />}
        {busy ? 'Preparing…' : `Download FY ${financialYear || ''}`}
      </motion.button>

      <AnimatePresence>
        {stage !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>
              {stage === 'done' ? (
                <Icon name="check-circle" size={13} style={{ color: 'var(--emerald)' }} />
              ) : (
                <Icon name="download" size={13} />
              )}
              <span>{STAGES[stage]}</span>
              {stage === 'downloading' && (
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                  {mb} MB{total > 0 ? ` · ${pct}%` : ''}
                </span>
              )}
            </div>

            <div style={{ height: 5, borderRadius: 999, background: 'var(--bg-inset)', overflow: 'hidden' }}>
              {stage === 'downloading' && total > 0 ? (
                <motion.div
                  animate={{ width: `${pct}%` }}
                  transition={{ ease: 'linear', duration: 0.2 }}
                  style={{ height: '100%', borderRadius: 999, background: 'var(--gradient-brand)' }}
                />
              ) : stage === 'done' ? (
                <div style={{ height: '100%', width: '100%', borderRadius: 999, background: 'var(--emerald)' }} />
              ) : (
                // Nothing measurable yet, so the bar says "working" rather than
                // inventing a percentage.
                <motion.div
                  animate={{ x: ['-100%', '250%'] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ height: '100%', width: '40%', borderRadius: 999, background: 'var(--gradient-brand)' }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
