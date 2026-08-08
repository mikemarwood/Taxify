import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

// One dialog for the whole app, asked for like window.confirm.
//
// There were a dozen window.confirm calls across eight files. Converting each
// one into its own piece of state and its own <ConfirmDialog> would have been a
// dozen chances to get it wrong, so this keeps the shape that made
// window.confirm easy to reach for — ask, await, carry on — and only changes
// what it looks like:
//
//   if (!(await confirm({ title: 'Delete this?' }))) return;
//
// The promise resolves false on cancel, on Escape, and on a click outside,
// exactly as the browser's does, so no call site has to think about it.

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  // Held outside state: resolving is not a render, and putting the resolver in
  // state would mean a stale one after a re-render mid-dialog.
  const resolver = useRef(null);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setRequest(typeof options === 'string' ? { title: options } : options || {});
    });
  }, []);

  const settle = useCallback((answer) => {
    setRequest(null);
    const resolve = resolver.current;
    resolver.current = null;
    if (resolve) resolve(answer);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={!!request}
        title={request?.title || 'Are you sure?'}
        body={request?.body}
        detail={request?.detail}
        confirmLabel={request?.confirmLabel || 'Confirm'}
        cancelLabel={request?.cancelLabel || 'Cancel'}
        tone={request?.tone}
        requireText={request?.requireText}
        // `=== true`, not `!== false`. The latter defaulted every dialog that
        // did not mention it back to closing on an outside click, quietly
        // undoing the component's own default — which is why finalise and
        // reopen still closed when you pressed beside them.
        dismissOnBackdrop={request?.dismissOnBackdrop === true}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  // Falling back to the browser's own rather than throwing: a missing provider
  // should not turn "asked to confirm" into a crash on the one path nobody
  // tested.
  if (!ctx) return (options) => Promise.resolve(window.confirm(options?.title || 'Are you sure?'));
  return ctx.confirm;
}
