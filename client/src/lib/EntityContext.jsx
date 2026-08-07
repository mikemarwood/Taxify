import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setEntityId } from './api.js';
import { useAuth } from './AuthContext.jsx';

// Which set of books you are looking at.
//
// One choice, held here and published to the shared axios instance, so every
// request the app makes carries it without any page having to remember. The
// alternative — a query parameter threaded through fifteen call sites — fails
// silently the first time one is missed, and answering about the wrong books is
// the worst way for this app to be wrong.

const EntityContext = createContext(null);

export const ALL_ENTITIES = 'all';

// Namespaced by whose books they are. Without this, opening a client as an
// accountant and going back to your own account would carry the client's
// selection with you — and the server would refuse it, leaving a dead app.
function storageKey(user) {
  const owner = user?.activeClient?.id ?? user?.accountHolderId ?? user?.id;
  return owner ? `taxify.entity.${owner}` : null;
}

export function EntityProvider({ children }) {
  const { user } = useAuth();
  const [entities, setEntities] = useState([]);
  const [archived, setArchived] = useState([]);
  // What the plan allows, so the page can say so before somebody types a name.
  const [allowance, setAllowance] = useState(null);
  const [selected, setSelected] = useState(ALL_ENTITIES);
  const [loading, setLoading] = useState(true);

  const key = storageKey(user);

  const load = useCallback(async () => {
    if (!user) {
      setEntities([]);
      setArchived([]);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/entities');
      setEntities(data.entities || []);
      setArchived(data.archived || []);
      setAllowance(data.allowance || null);

      const stored = key ? window.localStorage.getItem(key) : null;
      const known = (data.entities || []).some((e) => String(e.id) === String(stored));
      // An account with one set of books is always inside it — the combined
      // view of one thing is the thing, and offering both would be noise.
      const only = data.entities?.length === 1 ? String(data.entities[0].id) : null;
      const next = only || (known ? stored : ALL_ENTITIES);
      setSelected(next);
      setEntityId(next === ALL_ENTITIES ? null : next);
    } catch {
      setEntities([]);
      setArchived([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.activeClient?.id, key]);

  useEffect(() => {
    load();
  }, [load]);

  const choose = useCallback(
    (id) => {
      const next = id == null ? ALL_ENTITIES : String(id);
      setSelected(next);
      setEntityId(next === ALL_ENTITIES ? null : next);
      if (key) window.localStorage.setItem(key, next);
    },
    [key]
  );

  const value = useMemo(() => {
    const current = entities.find((e) => String(e.id) === String(selected)) || null;
    return {
      entities,
      // Kept apart from the list above on purpose: archived books are not
      // somewhere you can file, so nothing that offers a choice should see
      // them. They are listed only where they need explaining — Books.jsx,
      // because they still count against the plan.
      archived,
      allowance,
      loading,
      selected,
      selectedId: selected === ALL_ENTITIES ? null : Number(selected),
      entity: current,
      // What the expense form asks for when nothing is selected: somewhere to
      // file is required even when the view is combined.
      fallbackId: current?.id || entities.find((e) => e.isDefault)?.id || entities[0]?.id || null,
      isAll: selected === ALL_ENTITIES,
      // One set of books needs no switcher, and that is what keeps this
      // invisible for every account that has never made a second one.
      showSwitcher: entities.length > 0,
      choose,
      reload: load,
    };
  }, [entities, archived, allowance, selected, loading, choose, load]);

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>;
}

export function useEntities() {
  return (
    useContext(EntityContext) || {
      entities: [],
      allowance: null,
      loading: false,
      selected: ALL_ENTITIES,
      selectedId: null,
      entity: null,
      fallbackId: null,
      isAll: true,
      showSwitcher: false,
      choose: () => {},
      reload: () => {},
    }
  );
}
