// Opening Facebook's share dialog in a window of its own.
//
// A full tab for a dialog that is two fields and a button loses the page
// somebody was on — they come back to the app by finding it again among their
// tabs, if they come back at all. A small window sits over the page and closes
// itself, so the thing they were doing is still there behind it.
//
// Centred on the window it was opened from rather than on the screen, because
// on a second monitor a screen-centred popup opens on the wrong one.

const WIDTH = 600;
const HEIGHT = 640;

export function openShareWindow(url, name = 'taxify-share') {
  // dualScreenLeft covers Firefox, screenX the rest. A missing value is 0,
  // which is the primary monitor and the right answer when there is only one.
  const dualLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualTop = window.screenTop ?? window.screenY ?? 0;
  const outerW = window.outerWidth || document.documentElement.clientWidth || WIDTH;
  const outerH = window.outerHeight || document.documentElement.clientHeight || HEIGHT;

  const left = Math.max(0, dualLeft + (outerW - WIDTH) / 2);
  const top = Math.max(0, dualTop + (outerH - HEIGHT) / 2.4);

  const opened = window.open(
    url,
    name,
    `popup=yes,width=${WIDTH},height=${HEIGHT},left=${Math.round(left)},top=${Math.round(top)},` +
      // No toolbars on a dialog, but a scrollbar when it needs one — the
      // sharer grows once a preview loads and clipping it hides the button.
      'menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes'
  );

  // Blocked, or a browser that ignores the request. Reporting it lets the
  // caller fall back to an ordinary navigation rather than swallowing the
  // click and appearing to do nothing.
  if (!opened) return false;

  // Without this the popup can act on behalf of the page that opened it.
  // noopener on the anchor covers the fallback path; this covers ours.
  opened.opener = null;
  opened.focus?.();
  return true;
}

// For an anchor that already has a working href. Only cancels the navigation
// when a window actually opened, so a blocked popup still shares.
export function onShareClick(event) {
  const href = event.currentTarget?.href;
  if (!href) return;
  if (openShareWindow(href)) event.preventDefault();
}
