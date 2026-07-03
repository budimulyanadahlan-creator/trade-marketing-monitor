import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM ?? "Trade Marketing Monitor <noreply@example.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export interface SkpSubmittedEmailOptions {
  to: { email: string; name: string }[];
  campaignName: string;
  campaignId: string;
  submitterName: string;
  submittedAt: string;
}

export async function sendSkpSubmittedEmail(opts: SkpSubmittedEmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Email] RESEND_API_KEY not set — skipping email notification");
    }
    return;
  }

  const campaignUrl = `${APP_URL}/campaigns/${opts.campaignId}`;
  const dateFormatted = new Date(opts.submittedAt).toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });

  const results = await Promise.allSettled(
    opts.to.map(({ email, name }) =>
      resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `[Pengajuan SKP] ${opts.campaignName}`,
        html: buildSkpSubmittedHtml({ ...opts, recipientName: name, campaignUrl, dateFormatted }),
      })
    )
  );

  if (process.env.NODE_ENV === "development") {
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error("[Email] Some emails failed to send:", failed);
    }
  }
}

export interface PendingSkpItem {
  campaignId: string;
  campaignName: string;
  departmentName: string | null;
  submittedAt: string;
}

export interface SkpPendingDigestEmailOptions {
  to: { email: string; name: string }[];
  pendingItems: PendingSkpItem[];
}

export async function sendSkpPendingDigestEmail(opts: SkpPendingDigestEmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Email] RESEND_API_KEY not set — skipping digest notification");
    }
    return;
  }

  if (opts.pendingItems.length === 0) {
    return;
  }

  const subject = `[Pengingat SKP] ${opts.pendingItems.length} SKP menunggu persetujuan`;
  const approvalsUrl = `${APP_URL}/approvals`;
  const items = opts.pendingItems.map((item) => ({
    ...item,
    dateFormatted: new Date(item.submittedAt).toLocaleString("id-ID", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }),
  }));

  const results = await Promise.allSettled(
    opts.to.map(({ email, name }) =>
      resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject,
        html: buildSkpPendingDigestHtml({ recipientName: name, items, approvalsUrl }),
      })
    )
  );

  if (process.env.NODE_ENV === "development") {
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.error("[Email] Some digest emails failed to send:", failed);
    }
  }
}

export interface PasswordResetNotificationEmailOptions {
  to: { email: string; name: string };
}

export async function sendPasswordResetNotificationEmail(
  opts: PasswordResetNotificationEmailOptions
) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Email] RESEND_API_KEY not set — skipping password reset notification");
    }
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: opts.to.email,
    subject: "Password Anda Telah Direset",
    html: buildPasswordResetNotificationHtml({ recipientName: opts.to.name }),
  });
}

function buildPasswordResetNotificationHtml(opts: { recipientName: string }) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Anda Telah Direset</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1e3a8a;padding:28px 36px;">
              <p style="margin:0;color:#93c5fd;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Trade Marketing Monitor</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Password Anda Telah Direset</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 16px;color:#374151;font-size:15px;">Halo, <strong>${opts.recipientName}</strong>,</p>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;">Password akun Anda baru saja direset oleh administrator. Silakan hubungi admin Anda untuk mendapatkan password baru.</p>
              <p style="margin:0;color:#374151;font-size:15px;">Jika Anda tidak merasa meminta perubahan ini, segera hubungi administrator.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid #e5e7eb;background:#f9fafb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">Email ini dikirim otomatis oleh sistem Trade Marketing Monitor. Mohon tidak membalas email ini.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildSkpPendingDigestHtml(opts: {
  recipientName: string;
  items: (PendingSkpItem & { dateFormatted: string })[];
  approvalsUrl: string;
}) {
  const rows = opts.items
    .map(
      (item) => `
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;">${item.campaignName}</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;">${item.departmentName ?? "—"}</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;">${item.dateFormatted}</td>
                </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pengingat SKP Menunggu Persetujuan</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1e3a8a;padding:28px 36px;">
              <p style="margin:0;color:#93c5fd;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Trade Marketing Monitor</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Pengingat SKP Menunggu Persetujuan</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 16px;color:#374151;font-size:15px;">Halo, <strong>${opts.recipientName}</strong>,</p>
              <p style="margin:0 0 24px;color:#374151;font-size:15px;">Ada <strong>${opts.items.length} SKP</strong> yang masih menunggu persetujuan Anda:</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
                <tr>
                  <td style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;font-size:14px;">Nama Campaign</td>
                  <td style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;font-size:14px;">Dept</td>
                  <td style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;font-size:14px;">Diajukan</td>
                </tr>${rows}
              </table>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${opts.approvalsUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:13px 32px;border-radius:7px;text-decoration:none;font-weight:700;font-size:15px;">Buka Halaman Persetujuan</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid #e5e7eb;background:#f9fafb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">Email ini dikirim otomatis oleh sistem Trade Marketing Monitor. Mohon tidak membalas email ini.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildSkpSubmittedHtml(opts: {
  recipientName: string;
  campaignName: string;
  submitterName: string;
  dateFormatted: string;
  campaignUrl: string;
}) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pengajuan SKP Baru</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1e3a8a;padding:28px 36px;">
              <p style="margin:0;color:#93c5fd;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Trade Marketing Monitor</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Pengajuan SKP Baru</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 16px;color:#374151;font-size:15px;">Halo, <strong>${opts.recipientName}</strong>,</p>
              <p style="margin:0 0 24px;color:#374151;font-size:15px;">Ada pengajuan SKP baru yang memerlukan persetujuan Anda. Berikut detailnya:</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
                <tr>
                  <td style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;width:40%;font-size:14px;">Nama Campaign</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;">${opts.campaignName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;font-size:14px;">Diajukan Oleh</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;">${opts.submitterName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;background:#f9fafb;font-weight:600;color:#374151;font-size:14px;">Tanggal Pengajuan</td>
                  <td style="padding:12px 16px;color:#111827;font-size:14px;">${opts.dateFormatted}</td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${opts.campaignUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:13px 32px;border-radius:7px;text-decoration:none;font-weight:700;font-size:15px;">Lihat Detail SKP</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid #e5e7eb;background:#f9fafb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">Email ini dikirim otomatis oleh sistem Trade Marketing Monitor. Mohon tidak membalas email ini.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
