import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import { onShareClick } from '../lib/shareWindow.js';
import { trackClick } from '../lib/analytics.js';

// Asking a customer to share the app.
//
// The whole difficulty here is not building it, it is not becoming the thing
// people close without reading. So the rules it holds itself to:
//
//   Not on arrival. Somebody who has just signed in came to do something, and
//   a request for a favour before they have done it is an interruption. It
//   waits until they have been in the app a while.
//
//   Not to somebody new. Asking a person to recommend a product they have used
//   twice is asking them to vouch for something they cannot vouch for yet.
//
//   Once. Dismissing it puts it away for good, and sharing puts it away for
//   good. There is no second ask, no "remind me later" that comes back next
//   week — a prompt that returns after being refused is one somebody learns to
//   dismiss without looking, which costs more than the share was worth.
//
// The answer is kept in localStorage rather than on the account. It is a
// preference about one browser's furniture, not a fact about the customer, and
// it is not worth a column, a migration and a write on every dismissal.

const KEY = 'taxify.share.prompt';

// Long enough to have done something first. Not a delay for its own sake: the
// point is that the ask lands after the app has been useful, not before.
const AFTER_MS = 90 * 1000;

// Somebody who has been here a fortnight has an opinion worth asking for.
const MIN_ACCOUNT_AGE_DAYS = 14;

function alreadyAnswered() {
  try {
    return Boolean(window.localStorage.getItem(KEY));
  } catch {
    // Private browsing, or storage disabled. Treated as answered: an ask that
    // cannot be remembered is an ask that would return on every page load,
    // which is the one outcome worse than never asking.
    return true;
  }
}

function remember(answer) {
  try {
    window.localStorage.setItem(KEY, answer);
  } catch {
    // Nothing to do. It will not be shown again this session either way,
    // because the component removes itself.
  }
}

export default function SharePrompt({ user }) {
  const [config, setConfig] = useState(null);
  const [open, setOpen] = useState(false);

  const joinedDaysAgo = user?.createdAt
    ? (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  useEffect(() => {
    if (alreadyAnswered()) return undefined;
    if (joinedDaysAgo < MIN_ACCOUNT_AGE_DAYS) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      // Asked for at the last moment rather than on mount, so a page nobody
      // stays on does not fetch it at all — and so the switch being turned off
      // in admin takes effect without a reload.
      api
        .get('/social')
        .then(({ data }) => {
          if (cancelled || !data?.enabled || !data.shareUrl) return;
          setConfig(data);
          setOpen(true);
        })
        .catch(() => {
          // No prompt. A failed request is not worth telling anybody about.
        });
    }, AFTER_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [joinedDaysAgo]);

  function close(answer) {
    remember(answer);
    setOpen(false);
  }

  if (!config) return null;

  const encoded = encodeURIComponent(config.shareUrl);
  const quote = encodeURIComponent(String(config.shareUrl).replace(/\/+$/, ''));

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="share-prompt-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-modal="true"
          aria-label="Share Taxify"
          className="card share-prompt"
        >
          {/* Closed by the cross or by Not now, and by nothing else.
              
              Pressing beside it used to dismiss it. That reads as generous
              until you watch somebody do it: this appears over a page they
              were already working on, so the next click they make anywhere on
              that page lands on the backdrop and puts the thing away before
              they have read a word of it. Asked once and never again means the
              one ask is spent, and a stray click should not be what spends
              it. */}
          <button
            type="button"
            aria-label="Close"
            onClick={() => close('dismissed')}
            className="share-prompt-close"
          >
            &times;
          </button>

          {/* The mark on its own plate above the words rather than beside
              them. Beside them it was a 34px logo competing with a 14px line
              of type at the same weight, and the panel read as a notification
              — the shape people have learnt to dismiss without reading. */}
          <div className="share-prompt-crest">
            <img src="/logo.svg" alt="" width="30" height="30" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.3, lineHeight: 1.3 }}>
              Know somebody with a shoebox?
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              A share is the only advertising we do — no budget, no billboards. If Taxify has saved you an
              afternoon, telling one person is what keeps it going.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a
              className="btn btn-primary share-prompt-cta"
              style={{ gap: 8 }}
              href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}&quote=${quote}`}
              target="_blank"
              rel="noopener noreferrer"
              // Put away on the way out, not on the way back. Facebook opens in
              // another tab and never tells us what happened there, so waiting
              // for confirmation would mean waiting forever and asking again
              // tomorrow — which is exactly the behaviour this is trying not
              // to have.
              onClick={(e) => {
                trackClick('share', 'Facebook — prompt');
                onShareClick(e);
                close('shared');
              }}
            >
              <Icon name="globe" size={15} />
              Share on Facebook
            </a>

            {/* Stacked, not in a row. Three buttons side by side at 12.5px
                gave all three the same weight and wrapped raggedly at the
                panel's width; down the page the ask is unmistakably first and
                the way out is unmistakably last. */}
            {config.pageUrl && (
              <a
                className="btn btn-ghost share-prompt-cta"
                href={config.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => close('followed')}
              >
                Follow us instead
              </a>
            )}

            <button
              type="button"
              className="share-prompt-no"
              onClick={() => close('dismissed')}
            >
              Not now
            </button>
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
