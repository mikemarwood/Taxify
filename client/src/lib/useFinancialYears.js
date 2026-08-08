import { useEffect, useState } from 'react';
import { api } from './api.js';

// Every year picker in the app should offer the years this account actually
// has, not a fixed run of the last seven. Someone who started in 2025 being
// asked to choose between 2019-2020 and 2020-2021 is being asked a question
// with no right answer.
//
// `extra` lets a caller keep a year that must always be offerable even with no
// expenses in it yet — filing this year's paperwork before this year's first
// receipt, for instance.
export function useFinancialYears({ includeCurrent = true, extra = [], entityIds = null } = {}) {
  const [years, setYears] = useState(null);
  // The current year comes from the server, which knows the account's rule.
  // Working it out here meant defaulting to the Australian one, so a US or UK
  // account got a phantom "FY 2026-2027" the server would never produce —
  // selecting it filtered against a label that does not exist.
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Joined here rather than passed as an array, so the dependency below is
    // a string and does not refetch on every render.
    const scope = entityIds && entityIds.length > 0 ? entityIds.join(',') : '';

    api
      .get(`/expenses/years${scope ? `?entityIds=${encodeURIComponent(scope)}` : ''}`)
      .then((res) => {
        if (cancelled) return;
        setYears(res.data.years || []);
        setCurrent(res.data.current || null);
      })
      .catch(() => !cancelled && setYears([]));
    return () => {
      cancelled = true;
    };
    // Rerun when the chosen books change — the whole point is that the list
    // reflects them.
  }, [entityIds ? entityIds.join(',') : '']);

  const merged = Array.from(
    new Set([...(years || []), ...(includeCurrent && current ? [current] : []), ...extra.filter(Boolean)])
  )
    .sort()
    .reverse();

  return { years: merged, current, loading: years === null };
}
