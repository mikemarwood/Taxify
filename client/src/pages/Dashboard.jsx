import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SkeletonList, SkeletonStat } from '../components/Skeletons.jsx';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import { currentFinancialYear } from '../lib/financialYear.js';

export default function Dashboard() {
  const [expenses, setExpenses] = useState(null);
  const [year, setYear] = useState(null);

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

  const loading = expenses === null;

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
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Spending by category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {byCategory.map((c) => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 110, fontSize: 13, color: 'var(--text-muted)' }}>{c.name}</div>
                <div style={{ flex: 1, height: 8, background: 'var(--bg-elevated)', borderRadius: 999, overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(c.total / (byCategory[0].total || 1)) * 100}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ height: '100%', background: c.color, borderRadius: 999 }}
                  />
                </div>
                <div style={{ width: 90, textAlign: 'right', fontSize: 13, fontWeight: 600 }}>
                  ${c.total.toFixed(2)}
                </div>
              </div>
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
        <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
          <AnimatePresence initial={false}>
            {filtered.map((e, i) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.02 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 18px',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                {e.receiptUrl ? (
                  <a href={e.receiptUrl} target="_blank" rel="noreferrer">
                    <img src={e.receiptUrl} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border)' }} onError={(ev) => (ev.target.style.display = 'none')} />
                  </a>
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🧾</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.itemName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(e.purchaseDate).toLocaleDateString()} {e.isRecurring ? `· ${e.frequency}` : ''}
                  </div>
                </div>
                <CategoryBadge category={e.category} />
                <div style={{ width: 90, textAlign: 'right', fontWeight: 700 }}>${e.amount.toFixed(2)}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
