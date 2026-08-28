import nodemailer from 'nodemailer';
import { EMAIL_PATTERN } from './emailAddress.js';
import crypto from 'crypto';
import { getSetting, setSetting } from '../db.js';
import { publicOrigin, appOrigin } from './publicOrigin.js';

const SMTP_SETTING_KEYS = {
  host: 'smtp_host',
  port: 'smtp_port',
  secure: 'smtp_secure',
  user: 'smtp_user',
  password: 'smtp_password',
  from: 'smtp_from',
};

let transporter = null;
let transporterConfigKey = null;

export async function getSmtpConfig() {
  const [host, port, secure, user, password, from] = await Promise.all([
    getSetting(SMTP_SETTING_KEYS.host),
    getSetting(SMTP_SETTING_KEYS.port),
    getSetting(SMTP_SETTING_KEYS.secure),
    getSetting(SMTP_SETTING_KEYS.user),
    getSetting(SMTP_SETTING_KEYS.password),
    getSetting(SMTP_SETTING_KEYS.from),
  ]);
  return {
    host: host || process.env.SMTP_HOST || '',
    port: Number(port || process.env.SMTP_PORT) || 587,
    secure: (secure ?? process.env.SMTP_SECURE) === 'true',
    user: user || process.env.SMTP_USER || '',
    password: password || process.env.SMTP_PASSWORD || '',
    from: from || process.env.SMTP_FROM || 'Mikes App Hub <no-reply@mikesapphub.com>',
  };
}

export async function saveSmtpConfig({ host, port, secure, user, password, from }) {
  if (host !== undefined) await setSetting(SMTP_SETTING_KEYS.host, host);
  if (port !== undefined) await setSetting(SMTP_SETTING_KEYS.port, String(port));
  if (secure !== undefined) await setSetting(SMTP_SETTING_KEYS.secure, secure ? 'true' : 'false');
  if (user !== undefined) await setSetting(SMTP_SETTING_KEYS.user, user);
  if (password) await setSetting(SMTP_SETTING_KEYS.password, password);
  if (from !== undefined) await setSetting(SMTP_SETTING_KEYS.from, from);
  transporter = null;
  transporterConfigKey = null;
}

async function getTransporter() {
  const config = await getSmtpConfig();
  if (!config.host) {
    throw new Error('SMTP is not configured — set it up in Admin > Email server');
  }
  const key = JSON.stringify(config);
  if (transporter && transporterConfigKey === key) return transporter;
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  });
  transporterConfigKey = key;
  return transporter;
}

const BRAND = 'Taxify';
const BRAND_TAGLINE = 'Expense &amp; Receipt Tracking';
const NAVY = '#1e3a8a';

// One centred card on a tinted ground, which is what a modern transactional
// email looks like and what people now expect one to look like.
//
// The old layout was three stacked navy bands — wordmark, tagline, then the
// subject again — across 960px, with the message crammed underneath at 14px.
// It read as a notice from a system rather than a note from a company, and at
// 960 wide it was reflowed by every client that has an opinion, which is all
// of them.
//
// Deliberately plain in construction, because email is not the web:
//
//   Tables and inline styles only. Outlook renders with Word, which has no
//   flexbox, no grid, and no external stylesheet.
//
//   No images, not even the logo. Most clients block remote images by default,
//   so anything load-bearing that is an image is load-bearing and invisible.
//   The wordmark is text, so it always arrives.
//
//   600px, the width every client is designed around, and it degrades to full
//   width on a phone.
function renderEmail({ title, heading, bodyHtml }) {
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<!--[if mso]>
<style>
  /* Word has no web fonts and no line-height inheritance worth relying on, so
     the whole message is pinned to a face it definitely has and to line
     heights it will not reinterpret. */
  body, table, td, p, a, span { font-family: 'Segoe UI', Arial, sans-serif !important; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  p, td { mso-line-height-rule: exactly; }
</style>
<![endif]-->
<meta name="supported-color-schemes" content="light only">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f8;-webkit-font-smoothing:antialiased;">
<!-- Shown in the inbox list beside the subject, then hidden. Without it the
     preview is whatever the first words of the body happen to be. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${title} — ${BRAND}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center" style="padding:28px 14px;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

      <!-- Header -->
      <tr><td style="background:${NAVY};border-radius:12px 12px 0 0;padding:22px 32px;">
        <span style="font-size:23px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">${BRAND}</span>
        <span style="font-size:11px;font-weight:600;color:#a8c0f0;letter-spacing:0.6px;text-transform:uppercase;padding-left:10px;">${BRAND_TAGLINE}</span>
      </td></tr>

      <!-- The message -->
      <tr><td style="background:#ffffff;padding:32px;border-left:1px solid #dfe6f2;border-right:1px solid #dfe6f2;">
        <h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;font-weight:700;color:#0f172a;">${title}</h1>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">${heading}</p>
        ${bodyHtml}
      </td></tr>

      <!-- Footer, outside the card so it reads as small print -->
      <tr><td style="background:#ffffff;border-radius:0 0 12px 12px;border:1px solid #dfe6f2;border-top:0;padding:20px 32px;">
        <div style="font-size:12px;line-height:1.6;color:#94a3b8;">
          &copy; ${new Date().getFullYear()} ${BRAND} &middot;
          <a href="https://mikesapphub.com" style="color:#475569;text-decoration:underline;">Mikes App Hub</a><br>
          <strong style="color:#64748b;">Please do not reply to this email — this inbox is not monitored.</strong>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// A rough plain-text rendering of the same content. HTML with no text
// alternative is one of the cheaper things a spam filter marks against you,
// and it's what shows in a client with HTML disabled.
function htmlToText(heading, bodyHtml) {
  const body = String(bodyHtml)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—')
    .replace(/&copy;/g, '©')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `${heading}\n\n${body}\n\n--\n${BRAND}\nPlease do not reply to this email — this inbox is not monitored.`;
}

// "Taxify <no-reply@example.com>" -> "no-reply@example.com". The envelope and
// Message-ID need the bare address; the From header keeps the display name.
function senderAddress(from) {
  const match = /<([^>]+)>/.exec(String(from || ''));
  return (match ? match[1] : String(from || '')).trim();
}

export async function sendMail({ to, subject, title, heading, bodyHtml }) {
  const html = renderEmail({ title: title || 'Notification', heading, bodyHtml });
  const config = await getSmtpConfig();
  const address = senderAddress(config.from);

  await (await getTransporter()).sendMail({
    from: config.from,
    to,
    subject,
    html,
    text: htmlToText(heading, bodyHtml),
    // The envelope sender is what the receiving server checks SPF against, and
    // what ends up in Return-Path. Left unset, some relays send a null or
    // daemon return-path, which shows up as MAILER-DAEMON at the far end and
    // gives the recipient nothing to verify — a near-guaranteed trip to junk.
    // Pinning it to the same address as the From header is also what DMARC
    // alignment requires.
    envelope: { from: address, to },
    // Deliberately no Sender header. RFC 5322 says it belongs only when it
    // differs from From, and here it never does — a redundant one makes some
    // clients show "on behalf of" and gives a strict relay a reason to refuse.
    //
    // Generated from the sending domain rather than the machine's hostname,
    // which is usually something internal that matches nothing in DNS.
    messageId: `<${crypto.randomUUID()}@${address.split('@')[1] || 'localhost'}>`,
    // Transactional mail the recipient triggered by signing in. Auto-Submitted
    // stops other mail systems auto-replying to it, and the suppression header
    // keeps it out of out-of-office loops — both are things receivers look at.
    headers: {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
  });
}

export async function sendOtpEmail(to, name, code, expiresMinutes) {
  const firstName = String(name || '').trim().split(/\s+/)[0];
  await sendMail({
    to,
    // The code first, so it's readable from the notification without opening
    // anything. "Verification code" rather than anything urgent-sounding —
    // pressure words are exactly what filters score against.
    subject: `${code} is your ${BRAND} login code`,
    title: 'One-time login code',
    heading: `Hi${firstName ? ` ${firstName}` : ''}, use this code to finish signing in. It expires in ${expiresMinutes} minutes and can only be used once.`,
    bodyHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
        <tr><td align="center" style="background:#eef4fd;border:1px solid #d7e3f7;padding:26px 12px;">
          <span style="font-family:Consolas,'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:10px;color:#1d4ed8;">${code}</span>
        </td></tr>
      </table>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.5;">
        If you didn't try to sign in, ignore this email and change your password. This code on its own can't sign
        anyone in without your password.
      </p>
    `,
  });
}

function button(href, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;">
      <tr>
        <!--[if mso]>
        <td>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${href}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="18%" stroke="f" fillcolor="${NAVY}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:700;">${label}</center>
          </v:roundrect>
        </td>
        <![endif]-->
        <!--[if !mso]><!-->
        <td style="background:${NAVY};border-radius:8px;padding:14px 30px;" align="center">
          <a href="${href}" style="color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;display:inline-block;">${label}</a>
        </td>
        <!--<![endif]-->
      </tr>
    </table>`;
}

// The link is also given as text: some clients strip the button, and a link
// you can copy is the difference between a stuck user and a working one.
function linkFallback(url) {
  return `
    <p style="font-size:12.5px;color:#6b7280;margin:0 0 18px;line-height:1.5;word-break:break-all;">
      If the button doesn't work, copy this into your browser:<br>
      <a href="${url}" style="color:${NAVY};">${url}</a>
    </p>`;
}

function bullet(text) {
  return `<tr><td style="padding:0 0 6px;font-size:13.5px;color:#1f2937;line-height:1.45;mso-line-height-rule:exactly;">• ${text}</td></tr>`;
}

export async function sendActivationEmail(to, name, activationUrl, options = {}) {
  const { planType = 'individual', trialDays = 14, expiryDays = 5 } = options;
  const planLabel = planType === 'business' ? 'Small Business' : 'Individual';

  await sendMail({
    to,
    subject: 'Activate your Taxify account',
    title: 'Activate your account',
    heading: `Welcome${name ? `, ${name}` : ''} — one step to go.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Your Taxify account is created but not yet active. Opening the link below is where you choose your
        password — we deliberately didn't ask for one at sign-up, so nobody can set a password on an address
        they don't control.
      </p>
      ${button(activationUrl, 'Set my password and activate')}
      ${linkFallback(activationUrl)}

      <p style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#6b7280;margin:0 0 6px;">
        What you're activating
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
        ${bullet(`<strong>${planLabel} plan</strong>, on a ${trialDays}-day free trial`)}
        ${bullet('No card details needed — nothing is charged during the trial')}
        ${bullet('Unlimited expenses and receipts, filed by financial year and category')}
        ${bullet('Snap or drag receipts in from your phone or desktop')}
        ${bullet('Year-over-year reports, and Excel or PDF export for your accountant')}
      </table>

      <p style="font-size:13px;color:#4b5563;margin:0 0 8px;line-height:1.55;">
        <strong>This link expires in ${expiryDays} days.</strong> If it isn't used by then the account is removed
        automatically and you're welcome to sign up again — we'll send a reminder before that happens.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If you didn't sign up for Taxify, ignore this email. Without the link above, the account stays
        unusable and is deleted on its own.
      </p>
    `,
  });
}

export async function sendActivationReminderEmail(to, name, activationUrl, daysLeft) {
  await sendMail({
    to,
    subject: `Your Taxify account expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    title: 'Reminder: activate your account',
    heading: `Hi${name ? ` ${name}` : ''}, your Taxify account is still waiting on you.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        You signed up but haven't set a password yet, so the account can't be used. It'll be removed in
        <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> if it stays that way.
      </p>
      ${button(activationUrl, 'Set my password and activate')}
      ${linkFallback(activationUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        Didn't mean to sign up? Do nothing — the account deletes itself and no data is kept.
      </p>
    `,
  });
}

export async function sendAccountActivatedEmail(to, name, options = {}) {
  const { planType = 'individual', trialEndsAt = null, asAccountant = false } = options;
  const planLabel = planType === 'business' ? 'Small Business' : 'Individual';
  const loginUrl = `${appOrigin()}/login`;
  const trialLine = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  await sendMail({
    to,
    subject: 'Your Taxify account is active',
    title: 'Account activated',
    heading: `You're all set${name ? `, ${name}` : ''}.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Your password is set and the account is active. You can sign in with your email address and the
        password you just chose.
      </p>
      ${button(loginUrl, 'Sign in to Taxify')}

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
        ${
          asAccountant
            ? bullet('You have accountant access — there is no plan and nothing to pay')
            : bullet(`You're on the <strong>${planLabel} plan</strong>`)
        }
        ${trialLine ? bullet(`Your free trial runs until <strong>${trialLine}</strong>`) : ''}
        ${
          asAccountant
            ? bullet('Your clients invite you by email — their books appear on your list once you accept')
            : bullet('No card details are held — add them from Account when you\'re ready to continue')
        }
      </table>

      <p style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#6b7280;margin:0 0 6px;">
        A good first step
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
        ${
          asAccountant
            ? bullet('Tell your client the account is ready, and they can share their books with you')
            : bullet('Add an expense and drag its receipt in — that\'s the whole loop')
        }
        ${
          asAccountant
            ? bullet('Want books of your own as well? Add a plan from Account at any time')
            : bullet('Check Categories: a starter set is already there, and you can rename or add your own')
        }
        ${bullet('Two-factor sign-in is already on — every account has it, and it cannot be turned off')}
      </table>

      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If you didn't just activate an account, change your password immediately and let us know.
      </p>
    `,
  });
}

export async function sendPasswordResetEmail(to, name, resetUrl, expiryHours) {
  await sendMail({
    to,
    subject: 'Reset your Taxify password',
    title: 'Reset your password',
    heading: `Hi${name ? ` ${name}` : ''}, here's the link to set a new password.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Someone asked to reset the password on this account. If that was you, use the link below to choose
        a new one.
      </p>
      ${button(resetUrl, 'Set a new password')}
      ${linkFallback(resetUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0 0 8px;line-height:1.55;">
        <strong>This link expires in ${expiryHours} hours</strong> and can only be used once.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If you didn't ask for this, ignore this email — your password stays as it is, and the link expires
        on its own. Nobody can change your password without opening it.
      </p>
    `,
  });
}

export async function sendPasswordChangedEmail(to, name) {
  const loginUrl = `${appOrigin()}/login`;
  await sendMail({
    to,
    subject: 'Your Taxify password was changed',
    title: 'Password changed',
    heading: `Hi${name ? ` ${name}` : ''}, your password has been changed.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        You can now sign in with your new password. Any reset links sent earlier no longer work.
      </p>
      ${button(loginUrl, 'Sign in to Taxify')}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        <strong>If this wasn't you</strong>, reset your password again straight away from the sign-in page
        and check that the email address on the account is still yours.
      </p>
    `,
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// Sent to the address someone wants to move to, never to the one they have.
// The account keeps working on the old address until this link is opened, so a
// typo costs nothing and an unopened link changes nothing.
export async function sendEmailChangeEmail(to, name, confirmUrl, expiryHours, currentEmail) {
  await sendMail({
    to,
    subject: 'Confirm your new Taxify email address',
    title: 'Confirm your new email address',
    heading: `Hi${name ? ` ${name}` : ''}, confirm this address to finish the change.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        A request was made to change the email address on a Taxify account from
        <strong>${escapeHtml(currentEmail)}</strong> to this one. Open the link below to confirm it.
      </p>
      ${button(confirmUrl, 'Confirm this email address')}
      ${linkFallback(confirmUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0 0 8px;line-height:1.55;">
        <strong>This link expires in ${expiryHours} hours</strong> and can only be used once. Until it is
        opened the account carries on working on the old address — nothing changes on its own.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If you weren't expecting this, ignore the email. Whoever asked cannot complete the change without
        opening this link.
      </p>
    `,
  });
}

// And a heads-up to the address being left behind, so losing the sign-in on an
// account is never something that happens quietly.
export async function sendEmailChangedNoticeEmail(to, name, newEmail) {
  await sendMail({
    to,
    subject: 'The email address on your Taxify account was changed',
    title: 'Email address changed',
    heading: `Hi${name ? ` ${name}` : ''}, your sign-in address has changed.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        This account now signs in with <strong>${escapeHtml(newEmail)}</strong>. This address will no longer
        work for signing in.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        <strong>If this wasn't you</strong>, contact support straight away — your expenses and receipts are
        untouched, but someone else may now have the sign-in.
      </p>
    `,
  });
}

// Sent once per lodgement — a whole year for an individual, a quarter for a
// business that reports quarterly — and only to someone who hasn't already
// booked. One email per lodgement is a reminder; more than that is nagging, so
// the send is recorded and never repeated.
//
// `periodLabel` arrives ready to read ("FY 2025-2026", "Jul – Sep 2025"),
// because the caller is the only thing that knows which of those this is.
export async function sendBookTaxReminderEmail(to, name, periodLabel, endsOn, daysLeft, expenseCount, entityName) {
  const reportsUrl = `${appOrigin()}/reports`;
  const whose = entityName ? ` for ${entityName}` : '';
  await sendMail({
    to,
    subject: `${periodLabel} ends in ${daysLeft} days — time to book your tax appointment`,
    title: 'Time to book your tax appointment',
    heading: `Hi${name ? ` ${name}` : ''}, ${periodLabel}${whose} closes on ${endsOn}.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Good accountants fill up in the weeks after a period closes, so booking now tends to mean a better time slot
        rather than a better outcome later. You have <strong>${expenseCount} ${
          expenseCount === 1 ? 'expense' : 'expenses'
        }</strong> recorded${whose} so far.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Once you have a date, add it in Taxify and we'll count down to it — and stop sending this.
      </p>
      ${button(reportsUrl, 'Add my appointment')}
      ${linkFallback(reportsUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        This is the only reminder we'll send about booking ${periodLabel}.
      </p>
    `,
  });
}

// The day before an appointment someone entered themselves. They asked to be
// reminded by putting the date in, so this is the one email that is expected.
export async function sendTaxAppointmentReminderEmail(to, name, financialYear, when, company, accountant) {
  const reportsUrl = `${appOrigin()}/reports`;
  await sendMail({
    to,
    subject: `Tomorrow: your ${financialYear} tax appointment with ${company}`,
    title: 'Your tax appointment is tomorrow',
    heading: `Hi${name ? ` ${name}` : ''}, you're seeing ${escapeHtml(company)} tomorrow.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        <strong>${escapeHtml(when)}</strong>${accountant ? ` with ${escapeHtml(accountant)}` : ''}, for the
        <strong>${financialYear}</strong> financial year.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Everything for the year — the summary spreadsheet, a PDF, and every receipt in folders — downloads as a single
        zip from Reports, which is usually what an accountant wants handed over.
      </p>
      ${button(reportsUrl, 'Download my year')}
      ${linkFallback(reportsUrl)}
    `,
  });
}

// The four emails an accountant relationship actually produces. Between them
// they cover being asked, being given access, having it changed, and having it
// end — the last of which used to happen in complete silence.

// What the years line says, shared so four emails cannot describe the same
// grant four different ways.
function scopeSentence(yearScope) {
  if (!yearScope) return 'You can see their full history.';
  const years = yearScope.split(',');
  return `You can see the financial ${years.length === 1 ? 'year' : 'years'} <strong>${escapeHtml(
    years.join(', ')
  )}</strong>.`;
}

// Somebody who has no Taxify login yet. The invitation itself grants nothing —
// it is an offer, and it expires, and until it is accepted there is no account
// anywhere with their name on it.

// One labelled row of the invitation's summary panel. Tables and inline styles
// only, like everything else here — Outlook renders with Word.
function termRow(label, value, last = false) {
  return `
      <tr>
        <td style="padding:9px 14px;font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top;border-bottom:${last ? '0' : '1px solid #e6ecf5'};">${label}</td>
        <td style="padding:9px 14px;font-size:13px;color:#1f2937;line-height:1.5;border-bottom:${last ? '0' : '1px solid #e6ecf5'};">${value}</td>
      </tr>`;
}

function termsPanel(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6ecf5;border-radius:10px;background:#f8fafd;margin:0 0 18px;">
      ${rows.join('')}
    </table>`;
}

// Accepting happens in the app, not in this email.
//
// The link used to be the whole thing: open it and access was granted. A link
// in an inbox is forwardable, and a forwarded one granted a stranger sight of
// somebody's tax records — the only proof it carried was that the mail had
// reached *a* mailbox, not that the right person was reading it.
//
// Signing in is a stronger proof of the same thing. The address on the account
// was confirmed at activation, so matching it to the invitation says the person
// accepting holds that mailbox *and* the password. So this points at the client
// list, where Accept and Decline live, and grants nothing by being opened.
export async function sendAccountantInviteEmail(to, name, clientName, acceptUrl, yearScope, windowLabel, expiryLabel) {
  await sendMail({
    to,
    subject: `${clientName} would like to share their Taxify records with you`,
    title: 'An invitation to view a client\u2019s books',
    heading: `Hi${name ? ` ${escapeHtml(name)}` : ''}, ${escapeHtml(clientName)} has asked you to look over their records.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Taxify is where they keep their expenses and receipts. You already have a Taxify account, so there is nothing
        to set up — sign in and you will find them waiting on your client list, with Accept and Decline beside them.
        ${scopeSentence(yearScope)}
      </p>
      ${button(acceptUrl, 'Open my client list')}
      ${linkFallback(acceptUrl)}
      ${termsPanel([
        termRow('Client', escapeHtml(clientName)),
        termRow('Access', 'Read-only \u2014 you can read and export, never change'),
        termRow('Lasts', `${windowLabel}, counted from the first time you open their books \u2014 not from now`),
        termRow('Ends', 'Automatically when the time is up, or whenever they choose', true),
      ])}
      <p style="font-size:13px;color:#4b5563;margin:0 0 16px;line-height:1.55;">
        Sign in with the account this email was sent to. Nothing is granted by opening this email or the link in it —
        accepting is a button in the app, and only the account holding this address can press it.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        This invitation expires ${expiryLabel}. If you were not expecting it, ignore this email \u2014 nobody has been
        given anything, and it stops working on its own.
      </p>
    `,
  });
}

// A change to what this account is, confirmed to the person who made it.
//
// Sent to yourself rather than to anyone else, which is the point: turning on
// acting for clients is a change to what your login can be asked to do, and a
// change like that arriving in your inbox is how somebody notices one they did
// not make.
export async function sendAccountantRoleChangedEmail(to, name, nowActing) {
  const accountUrl = `${appOrigin()}/account`;
  await sendMail({
    to,
    // "Accountant access", not "acting for clients". The second is what the
    // flag does internally; the first is what somebody reading their inbox
    // recognises — and it matches what the same switch is called on the plans
    // page, so the email and the button agree.
    subject: nowActing ? 'Accountant access is on' : 'Accountant access is off',
    title: nowActing ? 'Accountant access is on' : 'Accountant access is off',
    heading: nowActing
      ? `Hi${name ? ` ${escapeHtml(name)}` : ''}, your account now has accountant access.`
      : `Hi${name ? ` ${escapeHtml(name)}` : ''}, accountant access has been turned off for your account.`,
    bodyHtml: nowActing
      ? `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Clients can share their books with you, and invitations will appear on your client list for you to accept or
        decline. Your own books and everything in them are untouched.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Two things are asked of anyone who reads somebody else's records: two-factor sign-in, and a practice or firm
        name so clients know who they have shared with. You will be prompted for both the first time you open a
        client.
      </p>
      ${button(accountUrl, 'See my account')}
      ${linkFallback(accountUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If this was not you, turn it off from that page and change your password.
      </p>
    `
      : `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Nobody can share their books with you any more, and you will not be sent invitations. Your own books and
        everything in them are untouched, and you can turn it back on whenever you like.
      </p>
      ${button(accountUrl, 'See my account')}
      ${linkFallback(accountUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If this was not you, turn it back on from that page and change your password.
      </p>
    `,
  });
}

// They said no.
//
// Worth an email rather than only a badge: the client asked somebody to look at
// their tax records and has been waiting for an answer, and "no" is an answer.
// Told plainly and without editorialising — an accountant declining is ordinary,
// usually because they are not that person's accountant.
export async function sendAccountantInviteDeclinedEmail(to, ownerName, accountantName, accountantEmail) {
  const who = accountantName
    ? `${escapeHtml(accountantName)} (${escapeHtml(accountantEmail)})`
    : escapeHtml(accountantEmail);
  const accountUrl = `${appOrigin()}/account`;
  await sendMail({
    to,
    subject: 'Your accountant invitation was declined',
    title: 'Invitation declined',
    heading: `Hi${ownerName ? ` ${escapeHtml(ownerName)}` : ''}, ${who} has declined your invitation.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Nothing was shared and nothing was opened. The invitation has been cleared, so you can invite somebody else
        whenever you are ready.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        If you expected them to accept, it is worth checking the address — an invitation goes to exactly the address
        it was typed with.
      </p>
      ${button(accountUrl, 'Invite somebody else')}
      ${linkFallback(accountUrl)}
    `,
  });
}

// Nobody answered, and the invitation has run out.
//
// The one thing a client could previously never find out. They invited an
// accountant, heard nothing, and the invitation quietly stopped working with no
// sign of it anywhere — so the books were not shared and nobody knew why.
export async function sendAccountantInviteExpiredEmail(to, ownerName, accountantEmail) {
  const accountUrl = `${appOrigin()}/account`;
  await sendMail({
    to,
    subject: 'Your accountant invitation has expired',
    title: 'Invitation expired',
    heading: `Hi${ownerName ? ` ${escapeHtml(ownerName)}` : ''}, ${escapeHtml(accountantEmail)} did not answer your invitation.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        It has expired without being accepted or declined, so nothing was shared and nothing was opened. The
        invitation has been cleared from your account.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Sending another one takes a moment. It is worth checking the address first, and worth telling them to expect
        it — an invitation that lands in a spam folder looks exactly like this one.
      </p>
      ${button(accountUrl, 'Send another invitation')}
      ${linkFallback(accountUrl)}
    `,
  });
}

// The way out, which had no email at all. Whether they revoked it, the window
// closed, or the client closed their account, the accountant found out by
// opening their list and seeing somebody missing.
export async function sendAccountantAccessEndedEmail(to, name, clientName, reason) {
  const why = {
    revoked: `${escapeHtml(clientName)} has removed your access to their records.`,
    expired: `Your window on ${escapeHtml(clientName)}'s records has closed.`,
    account_closed: `${escapeHtml(clientName)} has closed their Taxify account, so their records are no longer there.`,
  };
  await sendMail({
    to,
    subject: `Your access to ${clientName}'s records has ended`,
    title: 'Access ended',
    heading: `Hi${name ? ` ${escapeHtml(name)}` : ''}, ${why[reason] || why.revoked}`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        They are no longer on your client list. Nothing of yours was affected, and anything you downloaded while you
        had access is still yours.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        ${
          reason === 'account_closed'
            ? 'There is nothing to do here \u2014 this is only so you know why they disappeared.'
            : 'If you still need to look at their records, ask them to share them again.'
        }
      </p>
    `,
  });
}

// The invitation nobody accepted. Sent to the client rather than the invitee —
// the invitee is the one who did not act, and the client is the one whose plan
// quietly did not happen and who can do something about it.
export async function sendAccountantInviteLapsedEmail(to, ownerName, inviteeEmail, inviteeName) {
  const who = inviteeName
    ? `${escapeHtml(inviteeName)} (${escapeHtml(inviteeEmail)})`
    : escapeHtml(inviteeEmail);
  await sendMail({
    to,
    subject: 'Your accountant invitation has expired',
    title: 'Invitation expired',
    heading: `Hi${ownerName ? ` ${escapeHtml(ownerName)}` : ''}, the invitation you sent to ${who} has expired.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Invitations last 24 hours and this one was not accepted in that time. Nobody has been given access to your
        records, and the link in that email no longer works.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        If you still want them to look at your books, send it again from your account. It is one click, and the first
        email may simply have gone to their junk folder.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        Nothing needs doing if you have changed your mind.
      </p>
    `,
  });
}

// The client, told their accountant has taken up the invitation.
//
// They were told in the app and nowhere else, which assumes somebody who has
// just handed over sight of their tax records goes back and checks. This is
// the half of the exchange they actually care about — the accountant gets an
// email either way.
export async function sendAccountantInviteAcceptedEmail(to, ownerName, accountantName, accountantEmail, scopeLabel) {
  const who = accountantName
    ? `${escapeHtml(accountantName)} (${escapeHtml(accountantEmail)})`
    : escapeHtml(accountantEmail);
  const accountUrl = `${appOrigin()}/account`;
  await sendMail({
    to,
    subject: 'Your accountant now has access',
    title: 'Invitation accepted',
    heading: `Hi${ownerName ? ` ${escapeHtml(ownerName)}` : ''}, ${who} has accepted your invitation.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        They can now open ${escapeHtml(scopeLabel)}. You will be told the first time they actually do, and again if
        anything about their access changes.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Their access ends on its own. You can see exactly when, and end it sooner, from your account at any time —
        you do not need to ask them.
      </p>
      ${button(accountUrl, 'See their access')}
      ${linkFallback(accountUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If this was not you, remove their access from that page straight away.
      </p>
    `,
  });
}
// An address a client tried to share their books with, that has no confirmed
// Taxify account behind it.
//
// No invitation is created for these — there is nobody to accept one, and a
// live link sitting against an address anybody could later register would hand
// somebody's tax records to whoever got there first. So this is the whole of
// what we do: tell them their client is waiting, and how to be somebody who can
// be given access.
export async function sendAccountantSignUpNeededEmail(to, clientName, registerUrl) {
  const who = clientName ? escapeHtml(clientName) : 'A Taxify customer';
  await sendMail({
    to,
    subject: `${clientName || 'A client'} would like to share their Taxify records with you`,
    title: 'Your client is waiting',
    heading: `${who} would like you to look over their records.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Taxify is where they keep their expenses and receipts, ready for tax time. To be given access you need a
        Taxify account of your own at this email address — creating one takes a minute and there is nothing to pay
        to act for a client.
      </p>
      ${button(registerUrl, 'Create my account')}
      ${linkFallback(registerUrl)}
      ${termsPanel([
        termRow('Waiting for you', who),
        termRow('What to do', 'Create an account at this email address, then tell them it is ready'),
        termRow('Then', 'They share their books with you, and you accept from your email', true),
      ])}
      <p style="font-size:13px;color:#4b5563;margin:0 0 16px;line-height:1.55;">
        Let them know once you have signed up. Nothing has been shared with you yet, and they have to ask again once
        your account exists — we cannot give access to an address nobody has claimed.
      </p>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If you were not expecting this, ignore it. Nothing has been created and nobody has been given anything.
      </p>
    `,
  });
}

// The account has gone.
//
// Sent as it is deleted, not afterwards, so the last thing that happens to the
// address is an explanation rather than silence. Somebody who signed up, missed
// two reminders and then came looking a month later would otherwise find their
// email unrecognised at sign-in and no record anywhere of why.
//
// Warm rather than final: the overwhelmingly likely story is a first email that
// went to spam, not a decision. Signing up again takes a minute and costs
// nothing, and this says so.
export async function sendAccountRemovedEmail(to, name, registerUrl, days) {
  await sendMail({
    to,
    subject: 'Your Taxify sign-up has been removed',
    title: 'Sign-up removed',
    heading: `Hi${name ? ` ${escapeHtml(name)}` : ''}, we have cleared up your unfinished sign-up.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        You started a Taxify account ${days} days ago but never set a password, so it could not be used. We have
        removed it, along with the email address you gave us — we do not keep details for an account that was never
        finished.
      </p>
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Nothing has been lost: there was never anything in it. If the first email went to your junk folder, or life
        simply got in the way, starting again takes a minute and the 14-day free trial is still there.
      </p>
      ${button(registerUrl, 'Sign up again')}
      ${linkFallback(registerUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        If you did not sign up for Taxify, somebody typed your address by mistake and there is nothing left to do —
        the account is gone and you will hear no more about it.
      </p>
    `,
  });
}

export async function sendTrialEndingEmail(to, name, daysLeft, trialEndsAt) {
  const when = new Date(trialEndsAt).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
  await sendMail({
    to,
    subject: `Your Taxify trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    title: 'Trial ending soon',
    heading: `Hi ${name},`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        Your free trial ends on <strong>${when}</strong> (${daysLeft} day${daysLeft === 1 ? '' : 's'} from now).
        Subscribe from your Account page to keep uninterrupted access to your expenses, reports, and receipts.
      </p>
    `,
  });
}

export async function sendTrialExpiredEmail(to, name) {
  await sendMail({
    to,
    subject: 'Your Taxify trial has ended',
    title: 'Access restricted',
    heading: `Hi ${name},`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        Your 14-day free trial has ended, so access to your Taxify account is now restricted. Your data
        is safe and waiting for you — subscribe from your Account page any time to pick up right where
        you left off.
      </p>
    `,
  });
}

// Two quite different emails on the same schedule.
//
// A subscription renews itself, so the message is a courtesy: here is what will
// happen, do nothing. A year bought outright renews nothing, so the same
// message would be a lie with a deadline attached — they need to act, and the
// email is the only thing that will tell them.
export async function sendSubscriptionRenewingEmail(to, name, periodEnd, { autoRenews = true } = {}) {
  const when = new Date(periodEnd).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
  const accountUrl = `${appOrigin()}/account?tab=billing`;

  if (!autoRenews) {
    await sendMail({
      to,
      subject: `Your Taxify plan ends on ${when}`,
      title: 'Your plan is ending',
      heading: `Hi ${name},`,
      bodyHtml: `
        <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
          Your Taxify year ends on <strong>${when}</strong>. You paid for it outright rather than subscribing, so
          nothing renews on its own and there is no card on file to charge — renewing is one payment whenever
          you are ready.
        </p>
        ${button(accountUrl, 'Renew my plan')}
        <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
          Nothing is deleted if you let it lapse. Your books, expenses and receipts stay exactly where they are and
          come straight back when you renew — you simply cannot add to them in the meantime.
        </p>
      `,
    });
    return;
  }

  await sendMail({
    to,
    subject: `Your Taxify plan renews on ${when}`,
    title: 'Upcoming renewal',
    heading: `Hi ${name},`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        Just a heads-up — your annual Taxify plan will renew on <strong>${when}</strong> using the card
        on file. No action is needed unless you'd like to update your payment details or cancel from
        your Account page.
      </p>
    `,
  });
}

// Everything known about why mail isn't going out, in one call. Nodemailer's
// error messages on their own are terse ("Invalid login", "Connection closed")
// and don't say which of the several ways this can be misconfigured applies —
// so the config in use, the connection handshake and an actual send are each
// reported separately.
//
// The password is never returned, only whether one is set.
export async function diagnoseSmtp(to) {
  const config = await getSmtpConfig();
  const envelopeFrom = senderAddress(config.from);

  const report = {
    config: {
      host: config.host || null,
      port: config.port,
      secure: config.secure,
      user: config.user || null,
      hasPassword: Boolean(config.password),
      from: config.from || null,
      envelopeFrom: envelopeFrom || null,
    },
    checks: [],
  };

  function record(step, ok, detail) {
    report.checks.push({ step, ok, detail });
    return ok;
  }

  if (!config.host) {
    record('SMTP host configured', false, 'No host set — fill in Admin > Email server');
    return report;
  }
  record('SMTP host configured', true, `${config.host}:${config.port} (${config.secure ? 'TLS' : 'STARTTLS/plain'})`);

  // A From of "Taxify" with no address slips through the settings form but
  // gives an envelope sender no relay will accept.
  const fromValid = EMAIL_PATTERN.test(envelopeFrom);
  record(
    'From address is a real address',
    fromValid,
    fromValid ? envelopeFrom : `"${config.from}" has no usable address in it`
  );
  if (!fromValid) return report;

  // A From on a different domain to the SMTP account is the classic cause of
  // a rewritten sender: the relay won't send as a domain it doesn't own, so it
  // substitutes a bounce path and the mail arrives "on behalf of" — or as
  // MAILER-DAEMON. Not fatal (some setups legitimately differ), but it's
  // almost always a typo, so it's called out.
  if (config.user && config.user.includes('@')) {
    const fromDomain = envelopeFrom.split('@')[1]?.toLowerCase();
    const userDomain = config.user.split('@')[1]?.toLowerCase();
    const same = fromDomain === userDomain;
    record(
      'From matches the SMTP account',
      same,
      same
        ? `Both on ${fromDomain}`
        : `From is on "${fromDomain}" but the account is on "${userDomain}" — check for a typo. The relay will rewrite a sender it doesn't own.`
    );
  }

  let transporter;
  try {
    transporter = await getTransporter();
  } catch (err) {
    record('Build transport', false, err.message);
    return report;
  }

  // Connection and credentials, before anything is sent.
  try {
    await transporter.verify();
    record('Connect and authenticate', true, config.user ? `Authenticated as ${config.user}` : 'Connected (no auth)');
  } catch (err) {
    record('Connect and authenticate', false, describeSmtpError(err));
    return report;
  }

  try {
    await sendTestEmail(to);
    record('Send a test message', true, `Relay accepted the message for ${to}`);
  } catch (err) {
    record('Send a test message', false, describeSmtpError(err));
  }

  return report;
}

// Pulls the parts of a nodemailer error that actually identify the problem —
// the SMTP response code and the server's own words.
function describeSmtpError(err) {
  const parts = [];
  if (err.code) parts.push(err.code);
  if (err.responseCode) parts.push(`SMTP ${err.responseCode}`);
  parts.push(err.response || err.message || 'Unknown error');
  return parts.join(' · ');
}

export async function sendTestEmail(to) {
  await sendMail({
    to,
    subject: 'Mikes App Hub — test email',
    title: 'Test email',
    heading: 'It works!',
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0;line-height:1.5;">
        This is a test email sent from Admin &gt; Email server to confirm your SMTP settings are configured correctly.
      </p>
    `,
  });
}

// Sent whenever an account's plan changes, whoever changed it.
//
// A plan change is a change to what somebody is paying for and what they can
// do, so it gets the same treatment as a password change: told about, in
// writing, with what to do if it was not them.
export async function sendPlanChangedEmail(to, name, { fromLabel, toLabel, complimentary = false, until = null } = {}) {
  const accountUrl = `${appOrigin()}/account?tab=billing`;
  await sendMail({
    to,
    subject: `Your Taxify plan is now ${toLabel}`,
    title: 'Plan changed',
    heading: `Hi${name ? ` ${name}` : ''}, your plan has changed.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Your account has moved from <strong>${escapeHtml(fromLabel)}</strong> to
        <strong>${escapeHtml(toLabel)}</strong>.
      </p>
      ${
        complimentary
          ? `<p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
               This plan is on us${until ? ` until <strong>${escapeHtml(until)}</strong>` : ''} — there is nothing
               to pay and no card is needed.
             </p>`
          : `<p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
               Nothing about your renewal date changes. If there is a difference in price, it is worked out from
               today to the end of the year you have already paid for.
             </p>`
      }
      ${button(accountUrl, 'View your plan')}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        <strong>If you weren't expecting this</strong>, reply to this email and we'll put it back.
      </p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

// The message itself, quoted rather than paraphrased. Whitespace is preserved
// because people write in paragraphs and a wall of run-together text reads as
// carelessness on our part.
// Deliberately no quoting of the message.
//
// A support thread carries somebody's tax affairs, and people attach
// screenshots of their own records to one. Email is the wrong place for any of
// it: it sits unencrypted in two mailboxes, gets forwarded without thought, and
// a notification arriving on a phone puts its first line on a lock screen for
// whoever happens to be looking at it.
//
// So these emails say that something is waiting and where to read it, and
// nothing whatever about what it says.
function waitingNotice(text) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6ecf5;border-left:3px solid #94a3b8;border-radius:8px;background:#f8fafd;margin:0 0 18px;">
      <tr><td style="padding:14px 16px;font-size:13.5px;line-height:1.6;color:#4b5563;">${text}</td></tr>
    </table>`;
}

function ticketHeader(reference, subject, category) {
  return termsPanel([
    termRow('Ticket', `<strong>${escapeHtml(reference)}</strong>`),
    termRow('Subject', escapeHtml(subject)),
    termRow('Category', escapeHtml(category), true),
  ]);
}

// Sent when a ticket is raised, so there is a record of the number even if
// nobody replies for a day.
export async function sendSupportTicketRaisedEmail(to, name, { reference, subject, category, body, url }) {
  await sendMail({
    to,
    subject: `[${reference}] ${subject}`,
    title: 'We have your message',
    heading: `Hi${name ? ` ${escapeHtml(name)}` : ''}, thanks for writing in — this is your ticket number.`,
    bodyHtml: `
      ${ticketHeader(reference, subject, category)}
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        Somebody will read this and reply. You will get an email the moment they do, and you can follow the whole
        conversation here:
      </p>
      ${button(url, 'View my ticket')}
      ${linkFallback(url)}
      ${waitingNotice(
        'Your message is on the ticket rather than in this email. We keep what you write on the site, where it is behind your link and not sitting in an inbox.'
      )}
    `,
  });
}

// Somebody has replied and it is now the other person's turn. One email covers
// both directions — what changes is who receives it and what the link opens.
export async function sendSupportReplyEmail(to, name, { reference, subject, category, body, url, fromSupport }) {
  await sendMail({
    to,
    subject: `[${reference}] ${subject}`,
    title: fromSupport ? 'Support has replied' : 'A customer has replied',
    heading: fromSupport
      ? `Hi${name ? ` ${escapeHtml(name)}` : ''}, there is a reply waiting on your ticket.`
      : `${escapeHtml(name || 'A customer')} has replied and is waiting on you.`,
    bodyHtml: `
      ${ticketHeader(reference, subject, category)}
      ${waitingNotice(
        fromSupport
          ? 'The reply is on your ticket. We do not put what is written on a support ticket into an email — it stays on the site, where only you can open it.'
          : 'Their reply is on the ticket rather than in this email.'
      )}
      ${button(url, fromSupport ? 'Read and reply' : 'Open the ticket')}
      ${linkFallback(url)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        Replying on that page keeps everything in one thread.
      </p>
    `,
  });
}

// Closed. Said plainly, including how to get it reopened, because "closed" with
// no way back is how somebody ends up raising a second ticket about the first.
export async function sendSupportClosedEmail(to, name, { reference, subject, category, url }) {
  await sendMail({
    to,
    subject: `[${reference}] ${subject} — closed`,
    title: 'Your ticket has been closed',
    heading: `Hi${name ? ` ${escapeHtml(name)}` : ''}, this one is marked as done.`,
    bodyHtml: `
      ${ticketHeader(reference, subject, category)}
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        The conversation stays on your account and you can still read it. If it was not sorted, open it again from that
        page and tell us — no need to start a new one.
      </p>
      ${button(url, 'View the conversation')}
      ${linkFallback(url)}
    `,
  });
}

// Money in, to whoever runs the place.
//
// Not a receipt — Stripe already sends the customer one of those, and this is
// not addressed to them. It is the thing an owner wants to see land: somebody
// paid, this much, for this, and here is who. Sent through sendMail like every
// other message so it carries the site's own template rather than being the
// one plain-text email in the system.
export async function sendAdminPaymentEmail(to, { customerName, customerEmail, amount, kind, description, invoiceUrl, adminUrl }) {
  const what = kind === 'plan_change' ? 'a plan change' : 'a subscription';
  await sendMail({
    to,
    subject: `${amount} from ${customerName || customerEmail}`,
    title: 'Payment received',
    heading: `${amount} has come in for ${what}.`,
    bodyHtml: `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;width:120px;">Amount</td>
          <td style="padding:8px 0;font-size:15px;color:#111827;font-weight:700;">${escapeHtml(amount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;">Customer</td>
          <td style="padding:8px 0;font-size:14px;color:#1f2937;">
            ${escapeHtml(customerName || 'Unnamed account')}<br>
            <span style="color:#6b7280;">${escapeHtml(customerEmail || 'no address on file')}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#6b7280;">For</td>
          <td style="padding:8px 0;font-size:14px;color:#1f2937;">${escapeHtml(description || what)}</td>
        </tr>
      </table>
      ${adminUrl ? button(adminUrl, 'Open the admin panel') : ''}
      ${invoiceUrl ? `<p style="font-size:13px;color:#6b7280;margin:14px 0 0;">The Stripe invoice: <a href="${escapeHtml(invoiceUrl)}" style="color:#1559b8;">view it</a>.</p>` : ''}
    `,
  });
}
