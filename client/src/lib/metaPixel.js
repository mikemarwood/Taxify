// The two things we ever tell Meta, and nothing else.
//
// The pixel is initialised in index.html with autoConfig off, which stops it
// reading the page for itself — left on it watches form submissions and sends
// back the values of fields it decides look like contact details, and on this
// domain those fields are somebody's name, date of birth, phone number and
// email, and further in their expenses and receipts. So every event Meta
// receives is one written by hand, and this file is the whole list:
//
//   PageView            in index.html, when the document loads
//   CompleteRegistration here, once, after an account exists
//
// Neither carries a parameter. Meta is told that a trial started, not who
// started it — an event with no payload is enough to attribute an ad, and
// anything more would be sending a customer's details to an advertising
// network that has no need of them.

let alreadyReported = false;

// A new account exists. Called from the one place that knows that for certain:
// after the register call has returned without throwing.
//
// Guarded twice over. `alreadyReported` covers a double submit inside one page
// life, and the guard is deliberately module-level rather than component state
// so a remount cannot reset it. A reload starts a new page and a new module,
// but by then the form is gone and this cannot be reached without registering
// again — which would genuinely be a second registration.
export function reportRegistration() {
  if (alreadyReported) return;
  alreadyReported = true;
  try {
    // Absent when a blocker has removed it, which is common and is not an
    // error. Nothing here is allowed to interrupt a successful sign-up.
    window.fbq?.('track', 'CompleteRegistration');
  } catch {
    // Telling an advertising network about a sign-up is the least important
    // thing happening on this screen.
  }
}
