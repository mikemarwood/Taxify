import { useEffect, useState } from 'react';
import { api } from './api.js';
import { currentFinancialYear } from './financialYear.js';

// Every year picker in the app should offer the years this account actually
// has, not a fixed run of the last seven. Someone who started in 2025 being
// asked to choose between 2019-2020 and 2020-2021 is being asked a question
// with no right answer.
//
// `extra` lets a caller keep a year that must always be offerable even with no
// expenses in it yet — filing this year's paperwork before this year's first
// receipt, for instance.
export function useFinancialYears({ includeCurrent = true, extra = [] } = {}) {
  const [years, setYears] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/expenses/years')
      .then((res) => !cancelled && setYears(res.data.years || []))
      .catch(() => !cancelled && setYears([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const merged = Array.from(
    new Set([...(years || []), ...(includeCurrent ? [currentFinancialYear()] : []), ...extra.filter(Boolean)])
  )
    .sort()
    .reverse();

  return { years: merged, loading: years === null };
}
