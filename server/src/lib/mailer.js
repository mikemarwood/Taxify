import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP is not configured — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD in server/.env');
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

function renderEmail({ heading, bodyHtml }) {
  return `
  <div style="background:#0b0d12;padding:32px 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#171b26;border:1px solid #262b3a;border-radius:16px;overflow:hidden;">
      <div style="padding:28px 32px;background:linear-gradient(135deg,#8b5cf6,#3b82f6 55%,#06b6d4);">
        <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Taxify</span>
      </div>
      <div style="padding:32px;color:#e8e9f3;">
        <h1 style="font-size:19px;margin:0 0 16px;color:#e8e9f3;">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:18px 32px;border-top:1px solid #262b3a;color:#9198b0;font-size:12px;text-align:center;">
        &copy; ${new Date().getFullYear()} Taxify &middot; Powered by Mikes App Hub
      </div>
    </div>
  </div>`;
}

export async function sendMail({ to, subject, heading, bodyHtml }) {
  const html = renderEmail({ heading, bodyHtml });
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'Taxify <no-reply@taxify.local>',
    to,
    subject,
    html,
  });
}

export async function sendOtpEmail(to, name, code, expiresMinutes) {
  await sendMail({
    to,
    subject: `${code} is your Taxify login code`,
    heading: `Hi ${name}, here's your login code`,
    bodyHtml: `
      <p style="font-size:14px;color:#9198b0;margin:0 0 20px;">
        Enter this code to finish logging in to Taxify. It expires in ${expiresMinutes} minutes.
      </p>
      <div style="font-size:36px;font-weight:800;letter-spacing:10px;text-align:center;color:#fff;background:#12151d;border:1px solid #262b3a;border-radius:12px;padding:20px 0;margin:0 0 20px;">
        ${code}
      </div>
      <p style="font-size:13px;color:#9198b0;margin:0;">
        If you didn't try to log in, you can safely ignore this email — your account is still secure.
      </p>
    `,
  });
}
