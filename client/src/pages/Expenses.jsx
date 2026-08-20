import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { SkeletonList, SkeletonStat } from '../components/Skeletons.jsx';
import CategoryBadge from '../components/CategoryBadge.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import ExpenseModal from '../components/ExpenseModal.jsx';
import ReceiptLightbox from '../components/ReceiptLightbox.jsx';
import { defaultFinancialYear } from '../lib/financialYear.js';
import YearDocuments from '../components/YearDocuments.jsx';
import Icon from '../components/Icon.jsx';
import { formatMoney, claimable } from '../lib/money.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { formatDayMonth } from '../lib/dates.js';
import { formatHours } from '../lib/deductionInput.js';
import { Link } from 'react-router-dom';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import { useToast } from '../components/Toast.jsx';
import Amount from '../components/Amount.jsx';
import UnconvertedNotice from '../components/UnconvertedNotice.jsx';

// Lets the one search box take an amount as well as text. A bare number
// matches by prefix, so "47" finds $47.91 and $47.00 — typing the exact cents
// isn't required to find a receipt you half-remember. Comparisons and ranges
// are there because "everything over $500" is the other way people look for a
// specific expense.
function matchesAmount(amount, rawQuery) {
  // Amounts display grouped ("$1,000.00"), so a typed "1,000" has to find one —
  // the separators come straight back out of the search box.
  const query = rawQuery.replace(/,/g, '');
  const comparison = /^([<>]=?)\s*\$?(\d+(?:\.\d+)?)$/.exec(query);
  if (comparison) {
    const n = Number(comparison[2]);
    if (comparison[1] === '>') return amount > n;
    if (comparison[1] === '>=') return amount >= n;
    if (comparison[1] === '<') return amount < n;
    return amount <= n;
  }

  const range = /^\$?(\d+(?:\.\d+)?)\s*-\s*\$?(\d+(?:\.\d+)?)$/.exec(query);
  if (range) return amount >= Number(range[1]) && amount <= Number(range[2]);

  const bare = query.replace(/^\$/, '');
  if (!/^\d+(\.\d+)?$/.test(bare)) return false;
  return amount.toFixed(2).startsWith(bare);
}

// One of the two no-receipt panels at the foot of the list.
//
// Shaped like a category group above it — icon, name, count on the left, the
// total on the right — because it is the same kind of thing: a heap of entries
// that add up to part of a claim. What it adds up to is kilometres or hours,
// which is the only difference worth showing.
function DeductionPanel({ title, icon, rows, summary, render, onRemove, chips }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name={icon} size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>no receipt</span>
        <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{summary}</span>
      </div>
      {chips}
      <div className="card" style={{ overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div
            key={row.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 16px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
              fontSize: 13,
            }}
          >
            <span style={{ width: 78, flexShrink: 0, color: 'var(--text-muted)' }}>{formatDayMonth(row.date)}</span>
            {render(row)}
            {onRemove && (
              <button
                type="button"
                title="Remove this entry"
                aria-label="Remove this entry"
                onClick={() => onRemove(row.id)}
                style={{
                  lineHeight: 0,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <Link to="/add" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          Add another
        </Link>
      </div>
    </div>
  );
}

export default function Expenses() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const { isAll, showSwitcher } = useEntities();
  const [expenses, setExpenses] = useState(null);
  const [year, setYear] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  // Kilometres and hours, alongside the receipts they are claimed with.
  //
  // They are fetched separately because they are stored separately — a trip
  // has no amount, no category and no receipt, so it was never going to be a
  // row in the expenses table. That is a fact about our schema, though, and
  // not a reason for somebody to have to remember which page a Tuesday
  // afternoon ended up on.
  //
  // One year at a time, because that is what the endpoint serves and what a
  // claim is made in. Under "All years" the two panels stand down rather than
  // show one year of kilometres beside every year of receipts.
  const [deductions, setDeductions] = useState(null);

  function load() {
    api.get('/expenses').then((res) => {
      setExpenses(res.data.expenses);
      setYear((y) => y || defaultFinancialYear(res.data.expenses, user?.financialYearRule));
    });
  }

  useEffect(load, []);

  function loadDeductions(forYear = year) {
    if (!forYear || forYear === 'all') return;
    api
      .get(`/deductions/${encodeURIComponent(forYear)}`)
      .then((res) => setDeductions(res.data))
      .catch(() => setDeductions(null));
  }

  useEffect(() => {
    setDeductions(null);
    loadDeductions(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const years = useMemo(() => {
    if (!expenses) return [];
    return Array.from(new Set(expenses.map((e) => e.financialYear))).sort().reverse();
  }, [expenses]);

  const yearFiltered = useMemo(() => {
    if (!expenses) return [];
    if (year === 'all') return expenses;
    return expenses.filter((e) => e.financialYear === year);
  }, [expenses, year]);

  const categoryNames = useMemo(() => {
    if (!expenses) return [];
    return Array.from(new Set(expenses.map((e) => e.category?.name || 'Uncategorised'))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [expenses]);

  const searched = useMemo(() => {
    let list = yearFiltered;
    if (categoryFilter !== 'all') {
      list = list.filter((e) => (e.category?.name || 'Uncategorised') === categoryFilter);
    }
    if (!searchQuery.trim()) return list;

    const q = searchQuery.trim().toLowerCase();
    return list.filter(
      (e) =>
        e.itemName?.toLowerCase().includes(q) ||
        e.notes?.toLowerCase().includes(q) ||
        (e.category?.name || 'Uncategorised').toLowerCase().includes(q) ||
        matchesAmount(e.amount, q)
    );
  }, [yearFiltered, searchQuery, categoryFilter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const e of searched) {
      const key = e.category?.name || 'Uncategorised';
      const entry =
        map.get(key) || { name: key, color: e.category?.color || '#9198b0', icon: e.category?.icon, total: 0, items: [] };
      entry.total += claimable(e);
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
  const total = searched.reduce((sum, e) => sum + claimable(e), 0);

  // The same search box reads these too, over the words they actually have:
  // a vehicle and a purpose, or a note. Not the amount matcher — neither has
  // an amount, and "over $500" has nothing to say about a Tuesday's driving.
  const q = searchQuery.trim().toLowerCase();
  const tripRows = (deductions?.vehicle?.trips || []).filter(
    (t) => !q || t.vehicle.toLowerCase().includes(q) || t.purpose.toLowerCase().includes(q)
  );
  async function removeDeduction(kind, id) {
    if (!(await confirm({ tone: 'danger', title: 'Remove this entry?', confirmLabel: 'Remove' }))) return;
    try {
      await api.delete(`/deductions/${kind}/${id}`);
      loadDeductions();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const hourRows = (deductions?.homeOffice?.entries || []).filter((h) => !q || h.note.toLowerCase().includes(q));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Expenses</h1>
          <p style={{ color: 'var(--text-muted)', margin: '4px 0 0' }}>Every expense, grouped by category.</p>
        </div>
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
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{formatMoney(total)}</div>
          </motion.div>
          <motion.div className="card" style={{ padding: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Entries</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{searched.length}</div>
          </motion.div>
        </div>
      )}

      <UnconvertedNotice expenses={expenses} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <select className="input" value={year || ''} onChange={(e) => setYear(e.target.value)} style={{ width: 150, padding: '8px 10px', fontSize: 13 }}>
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ width: 190, padding: '8px 10px', fontSize: 13 }}
        >
          <option value="all">All categories</option>
          {categoryNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="input"
          placeholder="Search name, notes or amount…"
          title={'Type a name, or an amount: 47.91, 47, >100, <20, 50-100'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 280, padding: '8px 12px', fontSize: 13, marginLeft: 'auto' }}
        />
        {(searchQuery.trim() || categoryFilter !== 'all') && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12.5, padding: '7px 12px' }}
            onClick={() => {
              setSearchQuery('');
              setCategoryFilter('all');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Paperwork filed against the selected year, whatever category it
          was attached to — the year is what you are looking at here. */}
      <YearDocuments financialYear={year} title="Documents filed for this year" />

      {loading ? (
        <SkeletonList rows={6} />
      ) : groups.length === 0 && tripRows.length === 0 && hourRows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {searchQuery.trim() ? `No entries match "${searchQuery.trim()}".` : 'No expenses for this selection.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map((g) => (
            <div key={g.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Icon name={g.icon} size={15} style={{ color: g.color }} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700 }}>{g.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{formatMoney(g.total)}</span>
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
                      {/* Only in the combined view. Two sets of books can each
                          have a Tooling, and the category badge alone would make
                          them look like the same thing. */}
                      {isAll && showSwitcher && e.entity && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 999,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-inset)',
                            border: '1px solid var(--border)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {e.entity.name}
                        </span>
                      )}
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
            </div>
          ))}
        </div>
      )}

      {/* Kilometres and hours, in the same list as everything else.
          Their own panels rather than rows among the receipts: they are
          counted in km and hours, not money, and dropping a "—" into the amount
          column of a table that adds up would be a subtraction waiting to
          happen. Hidden while a category filter is on, since neither has one. */}
      {categoryFilter === 'all' && (
        <>
          <DeductionPanel
            title="Vehicle — kilometres driven"
            icon="car"
            rows={tripRows}
            summary={
              tripRows.length > 0
                ? `${tripRows.reduce((sum, t) => sum + t.km, 0).toLocaleString()} km · ${tripRows.length} trip${
                    tripRows.length === 1 ? '' : 's'
                  }`
                : null
            }
            onRemove={(id) => removeDeduction('vehicle-trips', id)}
            chips={
              // One line per car. Two sets of readings against one vehicle are
              // one claim, and where a country caps the kilometres per car, the
              // cap applies per car and not to the pile.
              (deductions?.vehicle?.vehicles || []).length > 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {deductions.vehicle.vehicles.map((v) => (
                    <span
                      key={v.vehicle}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '5px 11px',
                        borderRadius: 999,
                        background: 'var(--bg-inset)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {v.vehicle}: {v.claimableKm.toLocaleString()} km
                    </span>
                  ))}
                </div>
              )
            }
            render={(t) => (
              <>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{t.vehicle}</span>
                <span style={{ color: 'var(--text-muted)', flex: 2, minWidth: 0 }}>{t.purpose}</span>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{t.km.toLocaleString()} km</span>
              </>
            )}
          />
          <DeductionPanel
            title="Home office — hours worked"
            icon="home"
            rows={hourRows}
            summary={
              hourRows.length > 0
                ? `${formatHours(hourRows.reduce((sum, h) => sum + h.hours, 0))} · ${hourRows.length} day${
                    hourRows.length === 1 ? '' : 's'
                  }`
                : null
            }
            onRemove={(id) => removeDeduction('home-office', id)}
            render={(h) => (
              <>
                <span style={{ flex: 3, minWidth: 0, color: 'var(--text-muted)' }}>{h.note}</span>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatHours(h.hours)}</span>
              </>
            )}
          />
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
