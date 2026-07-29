import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { SkeletonList, SkeletonStat } from '../components/Skeletons.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import ExpenseModal from '../components/ExpenseModal.jsx';
import ReceiptLightbox from '../components/ReceiptLightbox.jsx';
import ReceiptInbox from '../components/ReceiptInbox.jsx';
import { defaultFinancialYear } from '../lib/financialYear.js';
import { iconEmoji } from '../lib/categoryIcons.js';

export default function Expenses() {
  const [expenses, setExpenses] = useState(null);
  const [year, setYear] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);

  function load() {
    api.get('/expenses').then((res) => {
      setExpenses(res.data.expenses);
      setYear((y) => y || defaultFinancialYear(res.data.expenses));
    });
  }

  function loadInboxCount() {
    api
      .get('/expenses/receipts/inbox')
      .then((res) => setInboxCount(res.data.files.length))
      .catch(() => setInboxCount(0));
  }

  useEffect(load, []);
  useEffect(loadInboxCount, []);

  const years = useMemo(() => {
    if (!expenses) return [];
    return Array.from(new Set(expenses.map((e) => e.financialYear))).sort().reverse();
  }, [expenses]);

  const yearFiltered = useMemo(() => {
    if (!expenses) return [];
    if (year === 'all') return expenses;
    return expenses.filter((e) => e.financialYear === year);
  }, [expenses, year]);

  const searched = useMemo(() => {
    if (!searchQuery.trim()) return yearFiltered;
    const q = searchQuery.trim().toLowerCase();
    return yearFiltered.filter(
      (e) =>
        e.itemName?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q) ||
        (e.category?.name || 'Uncategorised').toLowerCase().includes(q)
    );
  }, [yearFiltered, searchQuery]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const e of searched) {
      const key = e.category?.name || 'Uncategorised';
      const entry =
        map.get(key) || { name: key, color: e.category?.color || '#9198b0', icon: e.category?.icon, total: 0, items: [] };
      entry.total += e.amount;
      entry.items.push(e);
      map.set(key, entry);
    }
    const list = Array.from(map.values());
    for (const g of list) {
      g.items.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
    }
    return list.sort((a, b) => b.total - a.total);
  }, [searched]);

  const loading = expenses === null;
  const total = searched.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Expenses</h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>Every expense, grouped by category.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setInboxOpen(true)} style={{ fontSize: 13 }}>
          🧾 Receipt inbox
          {inboxCount > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 11.5,
                fontWeight: 700,
                background: 'var(--violet)',
                color: '#fff',
                borderRadius: 999,
                padding: '1px 8px',
              }}
            >
              {inboxCount}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <SkeletonStat />
          <SkeletonStat />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>${total.toFixed(2)}</div>
          </motion.div>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Entries</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{searched.length}</div>
          </motion.div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <select className="input" value={year || ''} onChange={(e) => setYear(e.target.value)} style={{ width: 160, padding: '8px 10px', fontSize: 13 }}>
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="input"
          placeholder="Search expenses…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 260, padding: '8px 12px', fontSize: 13, marginLeft: 'auto' }}
        />
      </div>

      {loading ? (
        <SkeletonList rows={6} />
      ) : groups.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {searchQuery.trim() ? `No entries match "${searchQuery.trim()}".` : 'No expenses for this selection.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map((g) => (
            <div key={g.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span aria-hidden="true">{iconEmoji(g.icon)}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700 }}>{g.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>${g.total.toFixed(2)}</span>
              </div>
              <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
                <AnimatePresence initial={false}>
                  {g.items.map((e, i) => (
                    <motion.div
                      key={e.id}
                      className="expense-row"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 10) * 0.02 }}
                      onClick={() => setSelectedExpense(e)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 16px',
                        borderBottom: i < g.items.length - 1 ? '1px solid var(--border)' : 'none',
                        fontSize: 13,
                        cursor: 'pointer',
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
                        {e.isRecurring && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {e.frequency}</span>}
                        {e.autoGenerated && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · auto-added</span>}
                      </span>
                      <CategoryBadge category={e.category} />
                      {e.receiptUrl && (
                        <button
                          type="button"
                          title="View receipt"
                          style={{ lineHeight: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                          onClick={(evt) => {
                            evt.stopPropagation();
                            setLightboxUrl(e.receiptUrl);
                          }}
                        >
                          🧾
                        </button>
                      )}
                      <span style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>${e.amount.toFixed(2)}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedExpense && (
        <ExpenseModal
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSaved={() => {
            setSelectedExpense(null);
            load();
            loadInboxCount();
          }}
          onDeleted={() => {
            setSelectedExpense(null);
            load();
          }}
        />
      )}

      {inboxOpen && <ReceiptInbox onClose={() => setInboxOpen(false)} onChanged={loadInboxCount} />}

      {lightboxUrl && <ReceiptLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
