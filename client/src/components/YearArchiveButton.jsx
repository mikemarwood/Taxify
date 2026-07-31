import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import ArchiveProgress from './ArchiveProgress.jsx';
import { useYearArchive } from '../lib/useYearArchive.js';

export default function YearArchiveButton({ financialYear, disabled }) {
  const archive = useYearArchive();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 260 }}>
      <motion.button
        type="button"
        className="btn btn-ghost"
        onClick={() => archive.start(financialYear)}
        disabled={archive.busy || disabled}
        whileHover={!archive.busy && !disabled ? { y: -1 } : undefined}
        style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        {archive.busy ? <span className="spinner" /> : <Icon name="download" size={15} />}
        {archive.busy ? 'Preparing…' : `Download FY ${financialYear || ''}`}
      </motion.button>

      <ArchiveProgress archive={archive} />
    </div>
  );
}
