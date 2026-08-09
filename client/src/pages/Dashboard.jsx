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
import { defaultFinancialYear, financialYearSpan } from '../lib/financialYear.js';
import Icon from '../components/Icon.jsx';
import { claimable } from '../lib/money.js';
import { FinancialYearCountdown, MonthlySpendChart, CategorySpendChart } from '../components/SpendCharts.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { describeSubscription, toneColor } from '../lib/subscription.js';
import { formatDayMonth } from '../lib/dates.js';
import Amount from '../components/Amount.jsx';
import UnconvertedNotice from '../components/UnconvertedNotice.jsx';

const COLLAPSED_ROW_COUNT = 8;

export default function Dashboard() {
  const { user } = useAuth();
  const billing = describeSubscription(user);
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
      setYear((y) => y || defaultFinancialYear(res.data.expenses, user?.financialYearRule));
    });
  }

  useEffect(load, []);

  // The years this account actually has, newest first, plus whichever one is
  // selected so the dropdown can never show a value that isn't among its
  // options — a select whose value matches nothing silently displays the first
  // one instead, and then the page disagrees with its own filter.
  const years = useMemo(() => {
    const found = new Set((expenses || []).map((e) => e.financialYear).filter(Boolean));
    if (year) found.add(year);
    return Array.from(found).sort().reverse();
  }, [expenses, year]);

  const filtered = useMemo(() => {
    if (!expenses) return [];
    if (!year) return expenses;
    return expenses.filter((e) => e.financialYear === year);
  }, [expenses, year]);

  const total = filtered.reduce((sum, e) => sum + claimable(e), 0);

  const thisMonthTotal = useMemo(() => {
    if (!expenses) return 0;
    const now = new Date();
    return expenses
      .filter((e) => {
        const d = new Date(e.purchaseDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + claimable(e), 0);
  }, [expenses]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      const key = e.category?.name || 'Uncategorised';
      const entry = map.get(key) || { name: key, color: e.category?.color || '#9198b0', icon: e.category?.icon, total: 0, count: 0 };
      entry.total += claimable(e);
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Dashboard</h1>
          {/* Which year everything below is about. It was only ever implied,
              which is a poor thing to leave to inference on a page of totals. */}
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {year ? (
              <>
                Your deductions for <strong style={{ color: 'var(--text)' }}>FY {year}</strong>
                <span style={{ opacity: 0.8 }}> · {financialYearSpan(user?.financialYearRule)}</span>
              </>
            ) : (
              'Your deductions at a glance.'
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Switching year is the most common thing anyone does here at tax
              time, so it sits with the heading rather than further down. */}
          {years.length > 0 && (
            <select
              className="input"
              aria-label="Financial year"
              value={year || ''}
              onChange={(e) => setYear(e.target.value)}
              style={{ width: 150, padding: '9px 10px', fontSize: 13 }}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  FY {y}
                </option>
              ))}
            </select>
          )}
          <ExportMenu baseUrl="/api/export/expenses" label="Export & download" archiveYear={year} />
          {user?.role !== 'accountant' && !user?.actingAsClient && (
            <Link to="/add" className="btn btn-primary">
              + Add expense
            </Link>
          )}
        </div>
      </div>

      <UnconvertedNotice expenses={expenses} />

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
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{byCategory[0]?.name || '—'}</div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <FinancialYearCountdown financialYear={year} rule={user?.financialYearRule} />
          </motion.div>

          {/* Only while something is actually running out.

              A card that says "Active" every day forever is a card nobody
              reads, and once it is ignored it can no longer do the one job it
              has: telling somebody their trial is about to end. So it appears
              for a trial, for a payment that failed, and for access that has
              lapsed — and is simply absent the rest of the time. A subscription
              renewing quietly needs no daily notice that it renewed quietly. */}
          {user?.role === 'owner' && ['trial', 'past_due', 'expired'].includes(billing.state) && (
            <motion.div
              className="card"
              style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 6 }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {billing.state === 'trial' ? 'Free trial' : 'Account'}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {billing.daysLeft !== null && billing.daysLeft > 0 ? (
                  <>
                    <span
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        color: toneColor(billing.tone),
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {billing.daysLeft}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {billing.daysLeft === 1 ? 'day left' : 'days left'}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 19, fontWeight: 700, color: toneColor(billing.tone) }}>
                    {billing.label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{billing.detail}</div>
              {(billing.tone === 'bad' || billing.tone === 'warn') && (
                <Link
                  to="/account?tab=billing"
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}
                >
                  See plans and subscribe →
                </Link>
              )}
            </motion.div>
          )}
        </div>
      )}

      {/* Two charts: one answers "when did I spend", the other "on what".
          Clicking a category filters the list below, so the chart is also the
          control rather than a picture beside one. */}
      {!loading && filtered.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <MonthlySpendChart expenses={filtered} financialYear={year} />
          <CategorySpendChart
            byCategory={byCategory}
            onSelect={(name) => setCategoryFilter(categoryFilter === name ? null : name)}
          />
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
                    {formatDayMonth(e.purchaseDate)}
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
                      style={{ lineHeight: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        setLightboxUrl({ url: e.receiptUrl, filename: e.receiptFilename });
                      }}
                    >
                      <Icon name="receipt" size={15} />
                    </button>
                  )}
                  <Amount expense={e} style={{ width: 96 }} />
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

      {lightboxUrl && (
        <ReceiptLightbox url={lightboxUrl.url} filename={lightboxUrl.filename} onClose={() => setLightboxUrl(null)} />
      )}
    </div>
  );
}
