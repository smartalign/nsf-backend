import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.resolve(__dirname, "../../nsf/src/assets/noble-logo.jpg");
const LOGO_CID = "nsf-logo";

const CONTACT_INBOX =
  process.env.CONTACT_INBOX_EMAIL || "info@noblescholarsfoundation.com";
const CONTACT_FROM_NAME =
  process.env.CONTACT_FROM_NAME || "Noble Scholars Foundation";

const getRequiredEnv = (key) => String(process.env[key] || "").trim();
const WEBSITE_URL =
  getRequiredEnv("WEBSITE_URL") || "https://noblescholarsfoundation.com";
const WHATSAPP_URL =
  getRequiredEnv("CONTACT_WHATSAPP_URL") || "https://wa.me/2349032924722";

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildInboxHtml = ({ name, email, subject, message }) => `
  <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 32px;">
          <img src="cid:${LOGO_CID}" alt="Noble Scholars Foundation" style="height:56px;width:auto;display:block;background:#ffffff;border-radius:12px;padding:6px;" />
          <p style="margin:18px 0 0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#f8fafc;opacity:0.82;font-weight:700;">New Website Inquiry</p>
        </div>
        <div style="padding:32px;">
          <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#0f172a;">A new contact form message has arrived.</h1>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;width:120px;font-weight:700;color:#334155;">Name</td>
              <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155;">Email</td>
              <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;"><a href="mailto:${escapeHtml(email)}" style="color:#b8860b;text-decoration:none;">${escapeHtml(email)}</a></td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155;">Subject</td>
              <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtml(subject)}</td>
            </tr>
          </table>
          <div style="border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;padding:20px;">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;font-weight:700;">Message</p>
            <p style="margin:0;font-size:15px;line-height:1.75;color:#334155;white-space:pre-wrap;">${escapeHtml(message)}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const buildAutoReplyHtml = ({ name }) => `
  <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:32px 32px 28px;">
          <img src="cid:${LOGO_CID}" alt="Noble Scholars Foundation" style="height:60px;width:auto;display:block;background:#ffffff;border-radius:14px;padding:6px;" />
          <p style="margin:18px 0 0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#f8fafc;opacity:0.82;font-weight:700;">We Received Your Message</p>
          <h1 style="margin:14px 0 0;font-size:28px;line-height:1.25;color:#ffffff;">Thank you for contacting Noble Scholars Foundation.</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">Hi ${escapeHtml(name)},</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#334155;">
            Thanks for reaching out to <strong>Noble Scholars Foundation</strong>. We have received your message and our team will get back to you shortly.
          </p>
          <div style="margin:24px 0;padding:22px 24px;border-radius:18px;background:linear-gradient(135deg,rgba(184,134,11,0.08),rgba(15,23,42,0.04));border:1px solid rgba(184,134,11,0.18);">
            <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8a6d1f;font-weight:700;">What Happens Next</p>
            <ul style="margin:0;padding-left:18px;color:#334155;font-size:15px;line-height:1.8;">
              <li>Our team will review your message carefully.</li>
              <li>You will receive a follow-up response as soon as possible.</li>
              <li>If your inquiry is urgent, you can also reach us through our direct contact channels below.</li>
            </ul>
          </div>
          <div style="margin:28px 0 0;">
            <a href="mailto:${CONTACT_INBOX}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;margin-right:10px;">Email Us</a>
            <a href="${WHATSAPP_URL}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#f8fafc;color:#0f172a;text-decoration:none;font-weight:700;border:1px solid #cbd5e1;">WhatsApp</a>
          </div>
        </div>
        <div style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#475569;">
            Noble Scholars Foundation
          </p>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#64748b;">
            Empowering scholars to grow, lead, and thrive through knowledge, development, and community.
          </p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">
            <a href="${WEBSITE_URL}" style="color:#b8860b;text-decoration:none;">Website</a>
            &nbsp;•&nbsp;
            <a href="mailto:${CONTACT_INBOX}" style="color:#b8860b;text-decoration:none;">${CONTACT_INBOX}</a>
          </p>
        </div>
      </div>
    </div>
  </div>
`;

const createTransporter = () => {
  const host = getRequiredEnv("SMTP_HOST");
  const port = Number(process.env.SMTP_PORT || 587);
  const user = getRequiredEnv("SMTP_USER");
  const pass = getRequiredEnv("SMTP_PASS");

  if (!host || !port || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
};

router.post("/", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!name || !email || !subject || !message) {
    return res.status(400).json({
      success: false,
      message: "Name, email, subject, and message are required.",
    });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid email address.",
    });
  }

  const transporter = createTransporter();
  if (!transporter) {
    return res.status(500).json({
      success: false,
      message: "Email service is not configured on the server.",
    });
  }

  const fromEmail = getRequiredEnv("SMTP_FROM_EMAIL") || getRequiredEnv("SMTP_USER");

  try {
    await transporter.sendMail({
      from: `"${CONTACT_FROM_NAME}" <${fromEmail}>`,
      to: CONTACT_INBOX,
      replyTo: email,
      subject: `[Contact Form] ${subject}`,
      text:
        `New contact form submission\n\n` +
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Subject: ${subject}\n\n` +
        `Message:\n${message}`,
      html: buildInboxHtml({ name, email, subject, message }),
      attachments: [
        {
          filename: "noble-logo.png",
          path: LOGO_PATH,
          cid: LOGO_CID,
        },
      ],
    });

    await transporter.sendMail({
      from: `"${CONTACT_FROM_NAME}" <${fromEmail}>`,
      to: email,
      subject: "We received your message",
      text:
        `Subject: We received your message\n\n` +
        `Hi ${name}, thanks for contacting Noble Scholars Foundation. ` +
        `We've received your message and our team will get back to you shortly.`,
      html: buildAutoReplyHtml({ name }),
      attachments: [
        {
          filename: "noble-logo.png",
          path: LOGO_PATH,
          cid: LOGO_CID,
        },
      ],
    });

    return res.json({
      success: true,
      message: "Your message has been sent successfully.",
    });
  } catch (error) {
    console.error("Contact email error:", error);
    return res.status(500).json({
      success: false,
      message: "We could not send your message right now. Please try again later.",
    });
  }
});

export default router;
