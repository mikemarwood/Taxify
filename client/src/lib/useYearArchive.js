import { useState } from 'react';
import { useToast } from '../components/Toast.jsx';
import { playSuccess, playError, playClick } from './sounds.js';
import { getEntityId } from './api.js';

// A year's archive can be hundreds of megabytes and takes real time to build,
// so callers report what's happening rather than looking broken. The stages are
// honest: the server is genuinely gathering, then zipping, then the browser is
// genuinely downloading — progress tracks bytes received once they start
// arriving, because until the first byte lands there is nothing truthful to
// measure.
export const ARCHIVE_STAGES = {
  idle: null,
  requesting: 'Requesting your year…',
  building: 'Gathering receipts and building the archive…',
  downloading: 'Downloading…',
  done: 'Saved to your downloads',
};

export function useYearArchive() {
  const toast = useToast();
  const [stage, setStage] = useState('idle');
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);

  const busy = stage !== 'idle' && stage !== 'done';

  async function start(financialYear) {
    if (busy || !financialYear) return;
    playClick();
    setStage('requesting');
    setReceived(0);
    setTotal(0);

    const entityId = getEntityId();
    const archiveUrl = `/api/export/year/${encodeURIComponent(financialYear)}.zip${
      entityId ? `?entityId=${entityId}` : ''
    }`;

    // In the Android app, let the phone fetch it.
    //
    // The progress below works by reading the response in JavaScript and then
    // handing the finished bytes over as a blob: URL. Android's download
    // manager cannot fetch a blob: — it runs outside the webview and has no
    // access to whatever created it — so in the app that is a download which
    // silently never happens. A plain navigation reaches the DownloadListener
    // in MainActivity instead, which saves the file properly and shows its own
    // progress in the notification shade. Losing our progress bar inside the
    // app is a fair trade for the file arriving at all.
    if (typeof navigator !== 'undefined' && /TaxifyAndroid/i.test(navigator.userAgent || '')) {
      window.location.assign(archiveUrl);
      setStage('done');
      setTimeout(() => setStage('idle'), 4000);
      return;
    }

    try {
      const res = await fetch(archiveUrl, { credentials: 'include' });

      if (!res.ok) {
        // The failure body is JSON; the success body is a zip.
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `Could not build the archive (${res.status})`);
      }

      setStage('building');

      const length = Number(res.headers.get('Content-Length')) || 0;
      setTotal(length);

      // Read the stream so bytes can be counted. The server streams the zip as
      // it builds, so the first chunk arriving is the real "it's working".
      const reader = res.body.getReader();
      const chunks = [];
      let count = 0;
      let started = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!started) {
          started = true;
          setStage('downloading');
        }
        chunks.push(value);
        count += value.length;
        setReceived(count);
      }

      const blob = new Blob(chunks, { type: 'application/zip' });
      const name =
        res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
        `Taxify ${financialYear}.zip`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      playSuccess();
      setStage('done');
      setTimeout(() => setStage('idle'), 4000);
    } catch (err) {
      playError();
      setStage('idle');
      toast(err.message, 'error');
    }
  }

  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

  return { stage, busy, received, total, pct, start, message: ARCHIVE_STAGES[stage] };
}
