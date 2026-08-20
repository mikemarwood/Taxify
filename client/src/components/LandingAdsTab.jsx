import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.jsx';
import { useConfirm } from '../lib/ConfirmContext.jsx';
import Icon from './Icon.jsx';

// The two advertisement films on the public landing page.
//
// Uploaded here rather than deployed, which is the whole point: an
// advertisement is the thing most likely to need replacing at short notice —
// a new cut, a price that changed, a campaign that ended — and needing a
// release to swap one means it does not get swapped. They are written into
// uploads/ beside the receipts, so a deploy does not wipe them.
//
// A slot with no film is removed from the landing page altogether. The page has
// no JavaScript it can rely on (the hub proxy strips it), so the server cuts
// the markup on the way out rather than the page hiding itself.

function readableSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_BYTES = 200 * 1024 * 1024;

function Slot({ slot, index, state, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const videoInput = useRef(null);
  const posterInput = useRef(null);
  const [busy, setBusy] = useState('');
  // Bumped after every change so the <video> below refetches instead of
  // showing the film that was just replaced from cache.
  const [version, setVersion] = useState(0);

  async function upload(file, asPoster) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast(`That file is ${readableSize(file.size)} — the limit is 200 MB.`, 'error');
      return;
    }
    setBusy(asPoster ? 'poster' : 'video');
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/admin/landing-ads/${slot}${asPoster ? '?poster=1' : ''}`, form);
      toast(asPoster ? 'Poster updated' : 'Advertisement updated', 'success');
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    const ok = await confirm({
      tone: 'danger',
      title: `Take advertisement ${index} off the landing page?`,
      body: 'The film and its poster are deleted, and that frame is removed from the page entirely — visitors see the section without it rather than an empty player.',
      confirmLabel: 'Remove it',
    });
    if (!ok) return;
    setBusy('remove');
    try {
      await api.delete(`/admin/landing-ads/${slot}`);
      toast('Removed from the landing page', 'success');
      setVersion((v) => v + 1);
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const live = Boolean(state?.video);

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Icon name="image" size={16} style={{ color: live ? 'var(--emerald)' : 'var(--text-muted)' }} />
        <span style={{ fontWeight: 700 }}>Advertisement {index}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
            color: live ? '#fff' : 'var(--text-muted)',
            background: live ? 'var(--emerald)' : 'var(--bg-inset)',
            border: `1px solid ${live ? 'var(--emerald)' : 'var(--border)'}`,
          }}
        >
          {live ? 'On the page' : 'Empty'}
        </span>
        {live && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            {readableSize(state.video.bytes)}
          </span>
        )}
      </div>

      {live ? (
        // The film itself, exactly as a visitor gets it — the only check worth
        // having is watching the thing that is actually being served.
        <video
          key={version}
          controls
          playsInline
          preload="metadata"
          poster={state.poster ? `/media/ads/${slot}-poster?v=${version}` : undefined}
          src={`/media/ads/${slot}?v=${version}`}
          style={{ width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 10, display: 'block' }}
        />
      ) : (
        <div
          style={{
            aspectRatio: '16 / 9',
            borderRadius: 10,
            border: '1px dashed var(--border)',
            background: 'var(--bg-inset)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 16,
            fontSize: 12.5,
            color: 'var(--text-muted)',
            lineHeight: 1.55,
          }}
        >
          Nothing here yet — this frame is left off the landing page until a film is uploaded.
        </div>
      )}

      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/webm,.mp4,.webm,.m4v"
        style={{ display: 'none' }}
        onChange={(e) => {
          upload(e.target.files?.[0], false);
          e.target.value = '';
        }}
      />
      <input
        ref={posterInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          upload(e.target.files?.[0], true);
          e.target.value = '';
        }}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: 12.5 }}
          disabled={Boolean(busy)}
          onClick={() => videoInput.current?.click()}
        >
          {busy === 'video' && <span className="spinner" />}
          {live ? 'Replace film' : 'Upload film'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12.5 }}
          disabled={Boolean(busy)}
          onClick={() => posterInput.current?.click()}
          title="The still shown before anybody presses play"
        >
          {busy === 'poster' && <span className="spinner" />}
          {state?.poster ? 'Replace poster' : 'Add a poster'}
        </button>
        {live && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12.5, marginLeft: 'auto', color: 'var(--red)' }}
            disabled={Boolean(busy)}
            onClick={remove}
          >
            {busy === 'remove' && <span className="spinner" />}
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function LandingAdsTab() {
  const [slots, setSlots] = useState(null);
  const toast = useToast();

  function load() {
    api
      .get('/admin/landing-ads')
      .then((res) => setSlots(res.data.slots))
      .catch((err) => toast(err.message, 'error'));
  }

  useEffect(load, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Advertisements on the landing page</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Two films, shown side by side under "See it in action" on the public page at{' '}
          <a href="/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            taxify.mikesapphub.com
          </a>
          . They go live as soon as they finish uploading — no release needed. An empty slot is left off the page
          rather than shown as a blank player, and if both are empty the whole section disappears.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.6 }}>
          MP4 or WebM, up to 200&nbsp;MB. Landscape 16:9 fits the frame without bars. A poster is the still shown
          before anybody presses play — without one most browsers show the first frame, which is usually black.
          Nothing plays on its own and nothing is muted-autoplayed, so a visitor is never ambushed by sound.
        </p>
      </div>

      {slots === null ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {slots.map((s, i) => (
            <Slot key={s.slot} slot={s.slot} index={i + 1} state={s} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
