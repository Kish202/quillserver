// Email via Brevo's HTTP API (works where SMTP is blocked, e.g. Render).
// EMAIL_FROM must be a Brevo-verified sender. No key → log to console.
const BREVO_API_KEY = process.env.BREVO_API_KEY;

function parseSender(s: string): { name: string; email: string } {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || "Quill", email: m[2].trim() };
  return { name: "Quill", email: s.trim() };
}
const SENDER = parseSender(process.env.EMAIL_FROM || "Quill <no-reply@quill.app>");

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string
) {
  if (!BREVO_API_KEY) {
    console.log(
      `\n📧 [email:dev — no BREVO_API_KEY]\n   To:      ${to}\n   Subject: ${subject}\n   ${text}\n`
    );
    return;
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  console.log(`📧 (brevo) sent "${subject}" → ${to}`);
}

/* ------------------------------- templates ------------------------------- */

function shell(heading: string, body: string, cta: { label: string; href: string }) {
  return `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#2b2926">
    <div style="font-size:20px;font-weight:700">✎ Quill</div>
    <h1 style="font-size:22px;margin:24px 0 8px">${heading}</h1>
    <p style="font-size:14px;line-height:1.6;color:#56554f">${body}</p>
    <a href="${cta.href}" style="display:inline-block;margin:20px 0;background:#2b2926;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px">${cta.label}</a>
    <p style="font-size:12px;color:#8a897f;line-height:1.6">If the button doesn't work, copy this link:<br>${cta.href}</p>
    <p style="font-size:12px;color:#a8a79d;margin-top:24px">Quill — Insurance SEC Filings</p>
  </div>`;
}

export const verifyEmailHtml = (link: string) =>
  shell(
    "Verify your email",
    "Confirm your email address to finish setting up your Quill account.",
    { label: "Verify email", href: link }
  );

export const resetPasswordHtml = (link: string) =>
  shell(
    "Reset your password",
    "We received a request to reset your Quill password. This link expires in 1 hour. If you didn't request it, you can ignore this email.",
    { label: "Reset password", href: link }
  );
