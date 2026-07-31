import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { getSetting, setSetting } from '../db.js';

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

// Full-width bands rather than a floating rounded card: tables and solid
// blocks are what render consistently across Outlook, Gmail and the phone
// clients, where border-radius and box-shadow are routinely dropped.
function renderEmail({ title, heading, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:960px;">

      <tr><td style="background:${NAVY};padding:14px 20px;">
        <span style="font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">${BRAND}</span>
      </td></tr>

      <tr><td style="background:${NAVY};border-top:1px solid #2b4ba0;padding:6px 20px;">
        <span style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:1.2px;text-transform:uppercase;">${BRAND_TAGLINE}</span>
      </td></tr>

      <tr><td style="background:${NAVY};border-top:1px solid #2b4ba0;padding:8px 20px;">
        <span style="font-size:15px;font-weight:700;color:#ffffff;">${title}</span>
      </td></tr>

      <tr><td style="padding:14px 20px 20px;color:#1f2937;font-size:14px;line-height:1.5;">
        <p style="margin:0 0 12px;font-size:14px;color:#1f2937;">${heading}</p>
        ${bodyHtml}
      </td></tr>

      <tr><td style="background:#eef1f6;padding:16px 20px;text-align:center;">
        <div style="font-weight:700;color:#1f2937;font-size:13px;margin-bottom:4px;">${BRAND}</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">
          &copy; ${new Date().getFullYear()} ${BRAND} &middot;
          <a href="https://mikesapphub.com" style="color:${NAVY};text-decoration:none;">Mikes App Hub</a>
        </div>
        <div style="font-size:11px;color:#9ca3af;">This is an automated message, please do not reply directly.</div>
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
  return `${heading}\n\n${body}\n\n--\n${BRAND}\nThis is an automated message, please do not reply directly.`;
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
    sender: address,
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
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
      <tr><td style="background:${NAVY};border-radius:6px;">
        <a href="${href}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${label}</a>
      </td></tr>
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
  return `<tr><td style="padding:3px 0;font-size:13.5px;color:#1f2937;line-height:1.5;">• ${text}</td></tr>`;
}

export async function sendActivationEmail(to, name, activationUrl, options = {}) {
  const { planType = 'individual', trialDays = 14, expiryDays = 5 } = options;
  const planLabel = planType === 'family' ? 'Family' : 'Individual';

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
  const { planType = 'individual', trialEndsAt = null } = options;
  const planLabel = planType === 'family' ? 'Family' : 'Individual';
  const loginUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/login`;
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
        ${bullet(`You're on the <strong>${planLabel} plan</strong>`)}
        ${trialLine ? bullet(`Your free trial runs until <strong>${trialLine}</strong>`) : ''}
        ${bullet('No card details are held — add them from Account when you\'re ready to continue')}
      </table>

      <p style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#6b7280;margin:0 0 6px;">
        A good first step
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
        ${bullet('Add an expense and drag its receipt in — that\'s the whole loop')}
        ${bullet('Check Categories: a starter set is already there, and you can rename or add your own')}
        ${bullet('Turn on two-factor login from Account if you\'d like the extra step')}
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
  const loginUrl = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/login`;
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

export async function sendInviteEmail(to, name, role, acceptUrl, inviterName) {
  const roleLabel = role === 'accountant' ? 'accountant (read-only)' : 'family member';
  await sendMail({
    to,
    subject: `${inviterName} invited you to Taxify`,
    title: 'Account invitation',
    heading: `Hi${name ? ` ${name}` : ''}, ${inviterName} has invited you to Taxify.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        You've been added as a <strong>${roleLabel}</strong>. Setting a password is all that's left —
        it finishes creating your account.
      </p>
      ${button(acceptUrl, 'Set my password')}
      ${linkFallback(acceptUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        This link expires in 5 days. If you weren't expecting this, you can ignore it.
      </p>
    `,
  });
}

export async function sendAdminCreatedAccountEmail(to, name, acceptUrl) {
  await sendMail({
    to,
    subject: 'An account has been created for you on Taxify',
    title: 'Account created',
    heading: `Hi${name ? ` ${name}` : ''}, an account has been set up for you.`,
    bodyHtml: `
      <p style="font-size:14px;color:#1f2937;margin:0 0 16px;line-height:1.55;">
        An administrator created a Taxify account for you. Setting a password finishes it off and starts
        your 14-day free trial, with full access to every feature.
      </p>
      ${button(acceptUrl, 'Set my password')}
      ${linkFallback(acceptUrl)}
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.55;">
        This link expires in 5 days.
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

export async function sendSubscriptionRenewingEmail(to, name, periodEnd) {
  const when = new Date(periodEnd).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
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
