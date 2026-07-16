import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { SkeletonList } from '../components/Skeletons.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';

export default function RecycleBin() {
  const toast = useToast();
  const [expenses, setExpenses] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  function load() {
    api.get('/expenses/trash').then((res) => setExpenses(res.data.expenses));
  }

  useEffect(load, []);

  async function onRestore(id) {
    setBusyId(id);
    try {
      await api.post(`/expenses/${id}/restore`);
      toast('Expense restored', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onDeletePermanently(id) {
    setBusyId(id);
    try {
      await api.delete(`/expenses/${id}/permanent`);
      toast('Expense permanently deleted', 'success');
      setConfirmingId(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const loading = expenses === null;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Recycle Bin</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          Deleted expenses stay here for 30 days before being permanently removed. They aren't included in your
          dashboard totals or reports.
        </p>
      </div>

      {loading ? (
        <SkeletonList rows={6} />
      ) : expenses.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          The recycle bin is empty.
        </div>
      ) : (
        <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            {expenses.map((e, i) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.02 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  borderBottom: i < expenses.length - 1 ? '1px solid var(--border)' : 'none',
                  fontSize: 13,
                }}
              >
                <span style={{ width: 78, flexShrink: 0, color: 'var(--text-muted)' }}>
                  {new Date(e.purchaseDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.itemName}
                </span>
                <CategoryBadge category={e.category} />
                <span style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>${e.amount.toFixed(2)}</span>
                <span
                  title={`Permanently deleted ${e.daysRemaining} day${e.daysRemaining === 1 ? '' : 's'} from now`}
                  style={{
                    fontSize: 11.5,
                    color: e.daysRemaining <= 5 ? 'var(--red)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    width: 110,
                    textAlign: 'right',
                  }}
                >
                  {e.daysRemaining}d left
                </span>

                {confirmingId === e.id ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn-primary"
                      style={{ background: 'var(--red)', fontSize: 12, padding: '6px 10px' }}
                      disabled={busyId === e.id}
                      onClick={() => onDeletePermanently(e.id)}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '6px 10px' }}
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '6px 10px' }}
                      disabled={busyId === e.id}
                      onClick={() => onRestore(e.id)}
                    >
                      Restore
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '6px 10px' }}
                      disabled={busyId === e.id}
                      onClick={() => setConfirmingId(e.id)}
                    >
                      Delete forever
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
