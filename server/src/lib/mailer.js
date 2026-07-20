import nodemailer from 'nodemailer';
import { getSetting, setSetting, getServerName } from '../db.js';

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

function renderEmail({ title, heading, bodyHtml }) {
  return `
  <div style="background:#eef1f6;padding:32px 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,60,0.08);">
      <div style="padding:28px 32px;background:#1e3a8a;">
        <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;margin-bottom:14px;">Mikes App Hub</div>
        <div style="font-size:11px;font-weight:700;color:#93c5fd;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">Customer Portal</div>
        <div style="font-size:15px;font-weight:700;color:#ffffff;">${title}</div>
      </div>
      <div style="padding:32px;color:#1f2937;">
        <h1 style="font-size:19px;margin:0 0 16px;color:#1e3a8a;">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:20px 32px;background:#eef1f6;text-align:center;">
        <div style="font-weight:700;color:#1f2937;font-size:13px;margin-bottom:6px;">Mikes App Hub</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">
          &copy; ${new Date().getFullYear()} Mikes App Hub &middot; <a href="https://mikesapphub.com" style="color:#1e3a8a;text-decoration:none;">Mikes App Hub</a>
        </div>
        <div style="font-size:11px;color:#9ca3af;">This is an automated message, please do not reply directly.</div>
      </div>
    </div>
  </div>`;
}

export async function sendMail({ to, subject, title, heading, bodyHtml }) {
  const html = renderEmail({ title: title || 'Notification', heading, bodyHtml });
  const config = await getSmtpConfig();
  await (await getTransporter()).sendMail({
    from: config.from,
    to,
    subject,
    html,
  });
}

export async function sendOtpEmail(to, name, code, expiresMinutes) {
  await sendMail({
    to,
    subject: `${code} is your Mikes App Hub verification code`,
    title: 'Two-Step Verification',
    heading: 'Hi there,',
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        Someone (hopefully you) just entered your password. Use the two-step verification code below to finish signing in.
      </p>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 20px;">
        <div style="font-size:36px;font-weight:800;letter-spacing:12px;text-align:center;color:#1e3a8a;background:#f8fafc;padding:22px 0 14px;">
          ${code}
        </div>
        <div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#6b7280;background:#f1f5f9;padding:8px 0;">
          Verification code &middot; expires in ${expiresMinutes} minutes
        </div>
      </div>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.5;">
        Didn't try to sign in? Someone may know your password &mdash;
        <strong style="color:#1e3a8a;">change it straight away</strong> from your account settings. This code on its own
        can't sign anyone in without your password.
      </p>
    `,
  });
}

export async function sendActivationEmail(to, name, activationUrl) {
  const serverName = await getServerName();
  await sendMail({
    to,
    subject: `Activate your ${serverName} account`,
    title: 'Account Activation',
    heading: `Welcome, ${name}!`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        You're almost set up. Click the button below to activate your ${serverName} account and start your
        14-day free trial with full access to every feature.
      </p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${activationUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:8px;">
          Activate my account
        </a>
      </div>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.5;">
        This link expires in 5 days. If it's not used by then, the account is automatically removed
        and you're welcome to sign up again.
      </p>
    `,
  });
}

export async function sendInviteEmail(to, name, role, acceptUrl, inviterName) {
  const roleLabel = role === 'accountant' ? 'accountant (read-only)' : 'family member';
  const serverName = await getServerName();
  await sendMail({
    to,
    subject: `${inviterName} invited you to ${serverName}`,
    title: 'Account Invitation',
    heading: `Hi ${name},`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        ${inviterName} has invited you to ${serverName} as a <strong>${roleLabel}</strong>. Set a password to
        finish creating your account.
      </p>
      <div style="text-align:center;margin:0 0 20px;">
        <a href="${acceptUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:8px;">
          Set my password
        </a>
      </div>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.5;">
        This link expires in 5 days.
      </p>
    `,
  });
}

export async function sendTrialEndingEmail(to, name, daysLeft, trialEndsAt) {
  const when = new Date(trialEndsAt).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
  const serverName = await getServerName();
  await sendMail({
    to,
    subject: `Your ${serverName} trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    title: 'Trial Ending Soon',
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
  const serverName = await getServerName();
  await sendMail({
    to,
    subject: `Your ${serverName} trial has ended`,
    title: 'Access Restricted',
    heading: `Hi ${name},`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        Your 14-day free trial has ended, so access to your ${serverName} account is now restricted. Your data
        is safe and waiting for you — subscribe from your Account page any time to pick up right where
        you left off.
      </p>
    `,
  });
}

export async function sendSubscriptionRenewingEmail(to, name, periodEnd) {
  const when = new Date(periodEnd).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
  const serverName = await getServerName();
  await sendMail({
    to,
    subject: `Your ${serverName} plan renews on ${when}`,
    title: 'Upcoming Renewal',
    heading: `Hi ${name},`,
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0 0 20px;line-height:1.5;">
        Just a heads-up — your annual ${serverName} plan will renew on <strong>${when}</strong> using the card
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
    title: 'Test Email',
    heading: 'It works!',
    bodyHtml: `
      <p style="font-size:14px;color:#4b5563;margin:0;line-height:1.5;">
        This is a test email sent from Admin &gt; Email server to confirm your SMTP settings are configured correctly.
      </p>
    `,
  });
}
