import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SkeletonList, SkeletonStat } from '../components/Skeletons.jsx';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import ExpenseModal from '../components/ExpenseModal.jsx';
import ReceiptLightbox from '../components/ReceiptLightbox.jsx';
import ExportMenu from '../components/ExportMenu.jsx';
import { currentFinancialYear } from '../lib/financialYear.js';
import { iconEmoji } from '../lib/categoryIcons.js';
import { useAuth } from '../lib/AuthContext.jsx';

const COLLAPSED_ROW_COUNT = 8;

export default function Dashboard() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState(null);
  const [year, setYear] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date-desc');
  const [showDateRange, setShowDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState(null);

  function load() {
    api.get('/expenses').then((res) => {
      setExpenses(res.data.expenses);
      setYear((y) => y || currentFinancialYear());
    });
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!expenses) return [];
    if (!year) return expenses;
    return expenses.filter((e) => e.financialYear === year);
  }, [expenses, year]);

  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  const thisMonthTotal = useMemo(() => {
    if (!expenses) return 0;
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.purchaseDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenses]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      const key = e.category?.name || 'Uncategorised';
      const entry = map.get(key) || { name: key, color: e.category?.color || '#9198b0', icon: e.category?.icon, total: 0, count: 0 };
      entry.total += e.amount;
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  useEffect(() => {
    setShowAll(false);
    setCategoryFilter(null);
    setSearchQuery('');
    setFromDate('');
    setToDate('');
    setShowDateRange(false);
  }, [year]);

  useEffect(() => {
    setShowAll(false);
  }, [categoryFilter, searchQuery, sortBy, fromDate, toDate]);

  const categoryFilteredExpenses = useMemo(() => {
    let result = filtered;
    if (categoryFilter) {
      result = result.filter((e) => (e.category?.name || 'Uncategorised') === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((e) => e.itemName?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q));
    }
    if (fromDate) {
      result = result.filter((e) => e.purchaseDate.slice(0, 10) >= fromDate);
    }
    if (toDate) {
      result = result.filter((e) => e.purchaseDate.slice(0, 10) <= toDate);
    }
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'date-asc':
          return new Date(a.purchaseDate) - new Date(b.purchaseDate);
        case 'amount-desc':
          return b.amount - a.amount;
        case 'amount-asc':
          return a.amount - b.amount;
        default:
          return new Date(b.purchaseDate) - new Date(a.purchaseDate);
      }
    });
    return result;
  }, [filtered, categoryFilter, searchQuery, sortBy, fromDate, toDate]);

  const loading = expenses === null;
  const visibleExpenses = showAll ? categoryFilteredExpenses : categoryFilteredExpenses.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenCount = categoryFilteredExpenses.length - visibleExpenses.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>Your deductions at a glance.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ExportMenu baseUrl="/api/export/expenses" label="Export all" />
          {user?.role !== 'accountant' && (
            <Link to="/add" className="btn btn-primary">
              + Add expense
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total tracked</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
              <AnimatedNumber value={total} />
            </div>
          </motion.div>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Claimed this month</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>
              <AnimatedNumber value={thisMonthTotal} />
            </div>
          </motion.div>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Entries</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{filtered.length}</div>
          </motion.div>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Top category</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, color: byCategory[0]?.color }}>
              {byCategory[0]?.name || '—'}
            </div>
          </motion.div>
        </div>
      )}

      {!loading && byCategory.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Totals by category</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {byCategory.map((c, i) => {
              const active = categoryFilter === c.name;
              return (
                <motion.div
                  key={c.name}
                  className="card"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  transition={{ delay: Math.min(i, 10) * 0.03 }}
                  onClick={() => setCategoryFilter(active ? null : c.name)}
                  title={`View ${c.name} entries`}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    border: active ? `1px solid ${c.color}` : '1px solid var(--border)',
                    boxShadow: active ? `0 0 0 1px ${c.color}` : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span aria-hidden="true">{iconEmoji(c.icon)}</span>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>${c.total.toFixed(2)}</div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>{categoryFilter ? `${categoryFilter} entries` : 'Recent expenses'}</div>
        {categoryFilter && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setCategoryFilter(null)}
          >
            Clear filter ✕
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={() => setShowDateRange((v) => !v)}
        >
          {showDateRange ? 'Hide custom range' : 'Custom range'}
        </button>
        <select
          className="input"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{ padding: '8px 10px', fontSize: 13, marginLeft: 'auto' }}
        >
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Amount: high to low</option>
          <option value="amount-asc">Amount: low to high</option>
        </select>
        <input
          type="text"
          className="input"
          placeholder="Search expenses…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 240, padding: '8px 12px', fontSize: 13 }}
        />
      </div>
      {showDateRange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <label className="label" style={{ margin: 0 }}>From</label>
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 160 }} />
          <label className="label" style={{ margin: 0 }}>To</label>
          <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 160 }} />
          {(fromDate || toDate) && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => {
                setFromDate('');
                setToDate('');
              }}
            >
              Clear range ✕
            </button>
          )}
        </div>
      )}
      {loading ? (
        <SkeletonList rows={6} />
      ) : categoryFilteredExpenses.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {searchQuery.trim() && categoryFilter ? (
            `No entries in ${categoryFilter} match "${searchQuery.trim()}".`
          ) : searchQuery.trim() ? (
            `No entries match "${searchQuery.trim()}".`
          ) : categoryFilter ? (
            `No entries in ${categoryFilter} for this year.`
          ) : (
            <>No expenses yet for this year. <Link to="/add" style={{ color: 'var(--blue)' }}>Add your first one</Link>.</>
          )}
        </div>
      ) : (
        <>
          <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
            <AnimatePresence initial={false}>
              {visibleExpenses.map((e, i) => (
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
                    borderBottom: i < visibleExpenses.length - 1 ? '1px solid var(--border)' : 'none',
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
          {hiddenCount > 0 && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 12, width: '100%', fontSize: 13 }}
              onClick={() => setShowAll(true)}
            >
              View all {categoryFilteredExpenses.length} expenses
            </button>
          )}
          {showAll && categoryFilteredExpenses.length > COLLAPSED_ROW_COUNT && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 12, width: '100%', fontSize: 13 }}
              onClick={() => setShowAll(false)}
            >
              Show less
            </button>
          )}
        </>
      )}

      {selectedExpense && (
        <ExpenseModal
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSaved={() => {
            setSelectedExpense(null);
            load();
          }}
          onDeleted={() => {
            setSelectedExpense(null);
            load();
          }}
        />
      )}

      {lightboxUrl && <ReceiptLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  );
}
