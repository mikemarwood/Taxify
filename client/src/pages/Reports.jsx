import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { SkeletonList } from '../components/Skeletons.jsx';

export default function Reports() {
  const [expenses, setExpenses] = useState(null);

  useEffect(() => {
    api.get('/expenses').then((res) => setExpenses(res.data.expenses));
  }, []);

  const { categories, years, cellTotals, categoryTotals, yearTotals, grandTotal } = useMemo(() => {
    if (!expenses) {
      return { categories: [], years: [], cellTotals: new Map(), categoryTotals: new Map(), yearTotals: new Map(), grandTotal: 0 };
    }

    const categoryMap = new Map(); // name -> { name, color }
    const yearSet = new Set();
    const cells = new Map(); // `${category}|${year}` -> total
    const catTotals = new Map();
    const yrTotals = new Map();
    let grand = 0;

    for (const e of expenses) {
      const categoryName = e.category?.name || 'Uncategorised';
      const color = e.category?.color || '#9198b0';
      if (!categoryMap.has(categoryName)) categoryMap.set(categoryName, { name: categoryName, color });
      yearSet.add(e.financialYear);

      const key = `${categoryName}|${e.financialYear}`;
      cells.set(key, (cells.get(key) || 0) + e.amount);
      catTotals.set(categoryName, (catTotals.get(categoryName) || 0) + e.amount);
      yrTotals.set(e.financialYear, (yrTotals.get(e.financialYear) || 0) + e.amount);
      grand += e.amount;
    }

    const sortedCategories = Array.from(categoryMap.values()).sort(
      (a, b) => (catTotals.get(b.name) || 0) - (catTotals.get(a.name) || 0)
    );
    const sortedYears = Array.from(yearSet).sort();

    return { categories: sortedCategories, years: sortedYears, cellTotals: cells, categoryTotals: catTotals, yearTotals: yrTotals, grandTotal: grand };
  }, [expenses]);

  const loading = expenses === null;

  function fmt(value) {
    if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>Reports</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 24px' }}>Compare spending by category across tax years.</p>

      {loading ? (
        <SkeletonList rows={6} />
      ) : categories.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No expenses yet — add some to see year-over-year comparisons.
        </div>
      ) : (
        <motion.div
          className="card scrollbar-slim"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
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
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.name}>
                  <td style={tdStyle('left')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                      {c.name}
                    </span>
                  </td>
                  {years.map((y) => (
                    <td key={y} style={tdStyle('right')}>
                      {fmt(cellTotals.get(`${c.name}|${y}`))}
                    </td>
                  ))}
                  <td style={{ ...tdStyle('right'), fontWeight: 700 }}>{fmt(categoryTotals.get(c.name))}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...tdStyle('left'), fontWeight: 800, borderTop: '1px solid var(--border)' }}>Total</td>
                {years.map((y) => (
                  <td key={y} style={{ ...tdStyle('right'), fontWeight: 800, borderTop: '1px solid var(--border)' }}>
                    {fmt(yearTotals.get(y))}
                  </td>
                ))}
                <td style={{ ...tdStyle('right'), fontWeight: 800, borderTop: '1px solid var(--border)' }}>{fmt(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </motion.div>
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
