import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { SkeletonStat } from '../components/Skeletons.jsx';
import Icon from '../components/Icon.jsx';
import StatTile from '../components/StatTile.jsx';
import { CategoryYearChart, CategoryDonut } from '../components/ReportCharts.jsx';
import { claimable } from '../lib/money.js';
import CategoryBadge from '../components/CategoryBadge.jsx';
import ExpenseModal from '../components/ExpenseModal.jsx';
import ExportMenu from '../components/ExportMenu.jsx';
import YearArchiveButton from '../components/YearArchiveButton.jsx';
import YearDocuments from '../components/YearDocuments.jsx';
import TaxYears from '../components/TaxYears.jsx';
import { useEntities } from '../lib/EntityContext.jsx';
import { formatDateShort } from '../lib/dates.js';
import Amount from '../components/Amount.jsx';
import UnconvertedNotice from '../components/UnconvertedNotice.jsx';
import DeductionSummary from '../components/DeductionSummary.jsx';

export default function Reports() {
  const { isAll, showSwitcher } = useEntities();
  const [expenses, setExpenses] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [asPercent, setAsPercent] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [year, setYear] = useState('');

  function load() {
    api.get('/expenses').then((res) => setExpenses(res.data.expenses));
  }

  useEffect(load, []);

  // Every year this account has, whatever the page is currently scoped to —
  // the selector has to keep offering the others.
  const allYears = useMemo(() => {
    if (!expenses) return [];
    return Array.from(new Set(expenses.map((e) => e.financialYear).filter(Boolean))).sort();
  }, [expenses]);

  const { categories, years, cellTotals, categoryTotals, yearTotals, grandTotal } = useMemo(() => {
    if (!expenses) {
      return { categories: [], years: [], cellTotals: new Map(), categoryTotals: new Map(), yearTotals: new Map(), grandTotal: 0 };
    }

    // The page answers for one year unless it is asked for all of them. It
    // used to total every year regardless of what the selector said, which
    // only drove the archive download — so picking a year changed the button
    // and nothing else on the page.
    const scoped = year === 'all' ? expenses : expenses.filter((e) => e.financialYear === year);

    const categoryMap = new Map(); // name -> { name, color, icon }
    const yearSet = new Set();
    const cells = new Map(); // `${category}|${year}` -> total
    const catTotals = new Map();
    const yrTotals = new Map();
    let grand = 0;

    for (const e of scoped) {
      const categoryName = e.category?.name || 'Uncategorised';
      const color = e.category?.color || '#9198b0';
      const icon = e.category?.icon;
      if (!categoryMap.has(categoryName)) categoryMap.set(categoryName, { name: categoryName, color, icon });
      yearSet.add(e.financialYear);

      const key = `${categoryName}|${e.financialYear}`;
      cells.set(key, (cells.get(key) || 0) + claimable(e));
      catTotals.set(categoryName, (catTotals.get(categoryName) || 0) + claimable(e));
      yrTotals.set(e.financialYear, (yrTotals.get(e.financialYear) || 0) + claimable(e));
      grand += claimable(e);
    }

    const sortedCategories = Array.from(categoryMap.values()).sort(
      (a, b) => (catTotals.get(b.name) || 0) - (catTotals.get(a.name) || 0)
    );
    const sortedYears = Array.from(yearSet).sort();

    return { categories: sortedCategories, years: sortedYears, cellTotals: cells, categoryTotals: catTotals, yearTotals: yrTotals, grandTotal: grand };
  }, [expenses, year]);

  // Defaults to the most recent year with anything in it — the one someone is
  // almost always after at tax time.
  useEffect(() => {
    if (!year && allYears.length > 0) setYear(allYears[allYears.length - 1]);
  }, [allYears, year]);

  // The archive is always one year's worth, so when the page is showing all of
  // them the button still has to name one: the most recent, which is what it
  // opened on. Its own label says which year, so nothing is ambiguous.
  const archiveYear = year === 'all' ? allYears[allYears.length - 1] || '' : year;

  const loading = expenses === null;

  const filteredExpenses = useMemo(() => {
    if (!expenses || !categoryFilter) return [];
    return expenses
      .filter((e) => (e.category?.name || 'Uncategorised') === categoryFilter)
      .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
  }, [expenses, categoryFilter]);

  function fmt(value) {
    if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // A cell, either way round. The percentage is of that year's own total, so a
  // column adds up to 100% and reads as "where this year went". A year with
  // nothing in it has no denominator and stays a dash rather than becoming 0%.
  function cellText(value, yearTotal) {
    if (!asPercent) return fmt(value);
    if (!value || !yearTotal) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return `${((value / yearTotal) * 100).toFixed(1)}%`;
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Reports</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {year === 'all'
              ? 'Compare spending by category across tax years.'
              : `Spending by category for FY ${year}.`}
          </p>
        </div>
        {/* Export and download on one line. They were stacked, which read as
            two unrelated features rather than the two ways of getting your
            records out — and put a summary export a full row away from the
            archive it belongs beside.

            On a phone that line becomes three things stacked in a column, each
            a different width, right-aligned under a left-aligned heading — the
            ragged edge is what makes it look like a mistake rather than a
            group. So below 560px they go full width and left-aligned, in the
            order they are used: pick a year, take that year, take everything. */}
        <div className="reports-actions">
          <div className="reports-year">
            {/* This scopes the page, not just the download. Every figure,
                both charts and the table answer for whichever year is picked,
                and "All years" is how the comparison is reached. */}
            <select
              className="input"
              aria-label="Financial year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              style={{ flex: '1 1 128px', minWidth: 110, fontSize: 12.5, padding: '7px 9px' }}
            >
              {allYears
                .slice()
                .reverse()
                .map((y) => (
                  <option key={y} value={y}>
                    FY {y}
                  </option>
                ))}
              <option value="all">All years</option>
            </select>
            <YearArchiveButton financialYear={archiveYear} disabled={allYears.length === 0} />
          </div>
          <ExportMenu baseUrl="/api/export/categories" label="Export summary" />
        </div>
      </div>

      {/* In the combined view a category name is not enough to tell two sets
          of books apart, and merging them into one row would make the report
          wrong rather than merely unclear: they are different returns. */}
      {isAll && showSwitcher && (
        <div
          className="card"
          style={{ padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <Icon name="info" size={14} />
          Showing every set of books together. Pick one from the switcher to report on it alone.
        </div>
      )}

      <UnconvertedNotice expenses={expenses} />

      {loading ? (
        <div className="stat-row">
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
      ) : categories.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No expenses yet — add some to see year-over-year comparisons.
        </div>
      ) : (
        <>
          <div className="stat-row">
            <StatTile icon="cash" tint="blue" label="Grand total" value={fmt(grandTotal)} />
            {year === 'all' ? (
              <StatTile icon="calendar" tint="violet" label="Years compared" value={years.length} delay={0.05} />
            ) : (
              <StatTile icon="calendar" tint="violet" label="Financial year" value={`FY ${year}`} delay={0.05} />
            )}
            <StatTile icon="tag" tint="amber" label="Categories" value={categories.length} delay={0.1} />
          </div>

          {/* The same figures as the table at the foot of the page, read two
              other ways: which category and whether it is moving, then what
              shape the whole is. */}
          <div className="report-charts">
            <CategoryYearChart categories={categories} years={years} cellTotals={cellTotals} />
            <CategoryDonut categories={categories} categoryTotals={categoryTotals} grandTotal={grandTotal} singleYear={year !== 'all'} />
          </div>

          {/* What each year actually came back as, beside what it claimed —
              the only two numbers a year is really judged on. */}
          {/* What is actually being claimed, from all three sources, for
              the year selected for the archive. */}
          <DeductionSummary financialYear={archiveYear} expenseClaim={yearTotals.get(archiveYear) || 0} />

          {/* Filed paperwork belongs with the year it covers, and the year is
              right here. It used to be a stack of collapsed panels underneath
              this one, each repeating a heading the table above had already
              said — two lists about the same three years, read one after the
              other. */}
          <TaxYears
            years={years}
            spendByYear={yearTotals}
            expenses={expenses}
            renderDocuments={(y) => <YearDocuments financialYear={y} title="Documents filed" manage />}
          />

          {/* The table had no heading at all: it followed the year list
              directly and had to be worked out from its own column names. */}
          <div className="panel-head" style={{ marginTop: 24, alignItems: 'center' }}>
            <span className="panel-head-mark">
              <Icon name="list" size={17} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2>Spending by category and tax year</h2>
              <p>A detailed breakdown of your spending across each category and tax year.</p>
            </div>
            {/* Percentages are of that year's own total, so a column reads as
                "where this year's money went" rather than as a share of all
                years — which is what the Share column at the end already is. */}
            <div className="seg" role="group" aria-label="Show amounts or percentages">
              <button type="button" aria-pressed={!asPercent} onClick={() => setAsPercent(false)}>
                Amounts
              </button>
              <button type="button" aria-pressed={asPercent} onClick={() => setAsPercent(true)}>
                Percentages
              </button>
            </div>
          </div>

          <motion.div
            className="card scrollbar-slim report-scroll"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            style={{ overflowX: 'auto', padding: 0 }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr>
                  <th style={thStyle('left')}>Category</th>
                  {years.map((y) => (
                    <th key={y} style={thStyle('right')}>
                      FY {y}
                    </th>
                  ))}
                  <th style={{ ...thStyle('right'), fontWeight: 800 }}>Total</th>
                  <th className="col-share" style={{ ...thStyle('left'), width: 90 }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c, i) => {
                  const total = categoryTotals.get(c.name) || 0;
                  const share = grandTotal ? (total / grandTotal) * 100 : 0;
                  const active = categoryFilter === c.name;
                  return (
                    <tr
                      key={c.name}
                      className="reports-row"
                      onClick={() => setCategoryFilter(active ? null : c.name)}
                      title={`View ${c.name} entries`}
                      style={{ cursor: 'pointer', background: active ? 'var(--bg-elevated)' : undefined }}
                    >
                      <td style={tdStyle('left')}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <Icon name={c.icon} size={14} style={{ color: c.color }} />
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                          {c.name}
                        </span>
                      </td>
                      {years.map((y) => (
                        <td key={y} style={tdStyle('right')}>
                          {cellText(cellTotals.get(`${c.name}|${y}`), yearTotals.get(y))}
                        </td>
                      ))}
                      <td style={{ ...tdStyle('right'), fontWeight: 700 }}>{fmt(total)}</td>
                      <td className="col-share" style={tdStyle('left')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${share}%` }}
                              transition={{ delay: 0.2 + Math.min(i, 10) * 0.03, duration: 0.5, ease: 'easeOut' }}
                              style={{ height: '100%', background: c.color, borderRadius: 999 }}
                            />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 30, textAlign: 'right' }}>
                            {share.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ ...tdStyle('left'), fontWeight: 800, borderTop: '1px solid var(--border)' }}>Total</td>
                  {years.map((y) => (
                    <td key={y} style={{ ...tdStyle('right'), fontWeight: 800, borderTop: '1px solid var(--border)' }}>
                      {fmt(yearTotals.get(y))}
                    </td>
                  ))}
                  <td style={{ ...tdStyle('right'), fontWeight: 800, borderTop: '1px solid var(--border)' }}>{fmt(grandTotal)}</td>
                  <td style={{ ...tdStyle('left'), borderTop: '1px solid var(--border)' }} />
                </tr>
              </tbody>
            </table>
          </motion.div>

          <p className="scroll-hint" style={{ fontSize: 12, color: 'var(--text-muted)', margin: '-14px 0 24px', textAlign: 'center' }}>
            Swipe the table sideways to see every year.
          </p>

          {categoryFilter && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ fontWeight: 700 }}>{categoryFilter} entries</div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setCategoryFilter(null)}
                >
                  Clear filter ✕
                </button>
              </div>
              {filteredExpenses.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No entries in {categoryFilter}.
                </div>
              ) : (
                <div className="card scrollbar-slim" style={{ overflow: 'hidden' }}>
                  {filteredExpenses.map((e, i) => (
                    <div
                      key={e.id}
                      className="expense-row"
                      onClick={() => setSelectedExpense(e)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 16px',
                        borderBottom: i < filteredExpenses.length - 1 ? '1px solid var(--border)' : 'none',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ width: 78, flexShrink: 0, color: 'var(--text-muted)' }}>
                        {formatDateShort(e.purchaseDate)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.itemName}
                      </span>
                      <CategoryBadge category={e.category} />
                      <Amount expense={e} style={{ width: 96 }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Keyed on the expense, so a different one gets a fresh form.

          Without it the panel stays mounted while `expense` changes
          underneath it, and every useState initialiser in there — the
          amount, the date, the category — only ever ran for whichever
          expense was opened first. Opening a second one showed the first
          one's values, or whatever they had been edited to. */}
      {selectedExpense && (
        <ExpenseModal
          key={selectedExpense.id}
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
    </div>
  );
}

function thStyle(align) {
  return {
    textAlign: align,
    padding: '12px 16px',
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 600,
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };
}

function tdStyle(align) {
  return {
    textAlign: align,
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };
}
