import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon.jsx';

// Shared by the Reports button and the dashboard export menu so the archive
// reports itself identically wherever it is started from.
export default function ArchiveProgress({ archive }) {
  const { stage, received, total, pct, message } = archive;
  const mb = (received / (1024 * 1024)).toFixed(1);

  return (
    <AnimatePresence>
      {stage !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          style={{ overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12,
              color: 'var(--text-muted)',
              marginBottom: 5,
            }}
          >
            {stage === 'done' ? (
              <Icon name="check-circle" size={13} style={{ color: 'var(--emerald)' }} />
            ) : (
              <Icon name="download" size={13} />
            )}
            <span>{message}</span>
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
  );
}
