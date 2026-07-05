import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SkeletonList, SkeletonStat } from '../components/Skeletons.jsx';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import { currentFinancialYear } from '../lib/financialYear.js';

const COLLAPSED_ROW_COUNT = 8;

export default function Dashboard() {
  const [expenses, setExpenses] = useState(null);
  const [year, setYear] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.get('/expenses').then((res) => {
      setExpenses(res.data.expenses);
      setYear(currentFinancialYear());
    });
  }, []);

  const years = useMemo(() => {
    if (!expenses) return [];
    return Array.from(new Set(expenses.map((e) => e.financialYear))).sort().reverse();
  }, [expenses]);

  const filtered = useMemo(() => {
    if (!expenses) return [];
    if (!year) return expenses;
    return expenses.filter((e) => e.financialYear === year);
  }, [expenses, year]);

  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      const key = e.category?.name || 'Uncategorised';
      const entry = map.get(key) || { name: key, color: e.category?.color || '#9198b0', total: 0, count: 0 };
      entry.total += e.amount;
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  useEffect(() => {
    setShowAll(false);
  }, [year]);

  const loading = expenses === null;
  const visibleExpenses = showAll ? filtered : filtered.slice(0, COLLAPSED_ROW_COUNT);
  const hiddenCount = filtered.length - visibleExpenses.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>Your deductions at a glance.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {years.length > 0 && (
            <select className="input" style={{ width: 'auto' }} value={year || ''} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  FY {y}
                </option>
              ))}
            </select>
          )}
          <Link to="/add" className="btn btn-primary">
            + Add expense
          </Link>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
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
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Entries</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{filtered.length}</div>
          </motion.div>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Top category</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, color: byCategory[0]?.color }}>
              {byCategory[0]?.name || '—'}
            </div>
          </motion.div>
        </div>
      )}

      {!loading && byCategory.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>Totals by category</div>
            <Link
              to="/reports"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--cyan)',
                textDecoration: 'none',
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid var(--border)',
              }}
            >
              Compare years <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {byCategory.map((c, i) => (
              <motion.div
                key={c.name}
                className="card"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                style={{ padding: '10px 12px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>${c.total.toFixed(2)}</div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, marginBottom: 14 }}>Recent expenses</div>
      {loading ? (
        <SkeletonList rows={6} />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No expenses yet for this year. <Link to="/add" style={{ color: 'var(--cyan)' }}>Add your first one</Link>.
        </div>
      ) : (
        <>
          <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
            <AnimatePresence initial={false}>
              {visibleExpenses.map((e, i) => (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.02 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 16px',
                    borderBottom: i < visibleExpenses.length - 1 ? '1px solid var(--border)' : 'none',
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
                    {e.isRecurring && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {e.frequency}</span>}
                  </span>
                  <CategoryBadge category={e.category} />
                  {e.receiptUrl && (
                    <a href={e.receiptUrl} target="_blank" rel="noreferrer" title="View receipt" style={{ lineHeight: 0 }}>
                      🧾
                    </a>
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
              View all {filtered.length} expenses
            </button>
          )}
          {showAll && filtered.length > COLLAPSED_ROW_COUNT && (
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
    </div>
  );
}
