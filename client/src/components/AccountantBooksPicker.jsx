import { useEntities } from '../lib/EntityContext.jsx';

// Which sets of books an accountant may open. Shaped exactly like the financial
// years picker beside it, because they are the same kind of decision and having
// them look different would suggest they work differently.
//
// Hidden entirely when there is only one set of books: "all of them" and "the
// one" are the same grant, and asking is a question with one answer.
export default function AccountantBooksPicker({ allBooks, setAllBooks, picked, setPicked, chip }) {
  const { entities } = useEntities();
  if (!entities || entities.length < 2) return null;

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  return (
    <div>
      <div className="label" style={{ margin: '0 0 6px' }}>
        Which books
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer' }}>
        <input type="radio" checked={allBooks} onChange={() => setAllBooks(true)} />
        All my books
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
        <input type="radio" checked={!allBooks} onChange={() => setAllBooks(false)} />
        Only the ones I choose
      </label>

      {!allBooks && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {entities.map((e) => (
            <button key={e.id} type="button" onClick={() => toggle(e.id)} style={chip(picked.includes(e.id))}>
              {e.name}
            </button>
          ))}
        </div>
      )}

      {!allBooks && picked.length === 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>Choose at least one set of books</div>
      )}

      {/* Said plainly, because "all my books" is a standing grant rather than a
          snapshot — somebody adding a business next year would otherwise be
          surprised to find it already shared. */}
      {allBooks && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          Includes any new books you add later.
        </div>
      )}
    </div>
  );
}
