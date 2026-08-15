import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function (this: { emails: { send: typeof mockSend } }) {
    this.emails = { send: mockSend };
  }),
}));

import { sendSkpPendingDigestEmail, sendClaimSubmittedEmail } from "./email";

describe("sendSkpPendingDigestEmail", () => {
  const originalEnv = process.env;

  const pendingItems = [
    {
      campaignId: "camp-1",
      campaignName: "Promo Lebaran",
      departmentName: "Sales",
      submittedAt: "2026-07-01T01:00:00.000Z",
    },
  ];

  const recipients = [
    { email: "admin1@example.com", name: "Admin One" },
    { email: "admin2@example.com", name: "Admin Two" },
  ];

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: "re_test_key",
      SKP_EMAIL_ENABLED: "true",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("does not send when pendingItems is empty", async () => {
    await sendSkpPendingDigestEmail({ to: recipients, pendingItems: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;
    await sendSkpPendingDigestEmail({ to: recipients, pendingItems });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when SKP_EMAIL_ENABLED is not set, even with a valid RESEND_API_KEY", async () => {
    delete process.env.SKP_EMAIL_ENABLED;
    await sendSkpPendingDigestEmail({ to: recipients, pendingItems });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when SKP_EMAIL_ENABLED is set to a non-true value", async () => {
    process.env.SKP_EMAIL_ENABLED = "false";
    await sendSkpPendingDigestEmail({ to: recipients, pendingItems });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends one email per recipient with correct subject", async () => {
    await sendSkpPendingDigestEmail({ to: recipients, pendingItems });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin1@example.com",
        subject: "[Pengingat SKP] 1 SKP menunggu persetujuan",
      })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin2@example.com",
        subject: "[Pengingat SKP] 1 SKP menunggu persetujuan",
      })
    );
  });

  it("continues sending to other recipients when one fails", async () => {
    mockSend
      .mockRejectedValueOnce(new Error("bounce"))
      .mockResolvedValueOnce({ data: { id: "email-2" }, error: null });

    await expect(
      sendSkpPendingDigestEmail({ to: recipients, pendingItems })
    ).resolves.not.toThrow();

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe("sendClaimSubmittedEmail", () => {
  const originalEnv = process.env;

  const recipients = [
    { email: "finance1@example.com", name: "Finance One" },
    { email: "creator1@example.com", name: "Creator One" },
  ];

  const opts = {
    to: recipients,
    campaignName: "Promo Lebaran",
    campaignId: "camp-1",
    claimAmount: 1_500_000,
    submittedAt: "2026-08-15T01:00:00.000Z",
  };

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: "re_test_key",
      SKP_EMAIL_ENABLED: "true",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("does not send when SKP_EMAIL_ENABLED is not set", async () => {
    delete process.env.SKP_EMAIL_ENABLED;
    await sendClaimSubmittedEmail(opts);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;
    await sendClaimSubmittedEmail(opts);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends one email per recipient with correct subject", async () => {
    await sendClaimSubmittedEmail(opts);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "finance1@example.com",
        subject: "[Klaim Diajukan] Promo Lebaran",
      })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "creator1@example.com",
        subject: "[Klaim Diajukan] Promo Lebaran",
      })
    );
  });

  it("includes the formatted claim amount in the email body", async () => {
    await sendClaimSubmittedEmail(opts);

    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain("Rp");
    expect(call.html).toContain("1.500.000");
  });

  it("continues sending to other recipients when one fails", async () => {
    mockSend
      .mockRejectedValueOnce(new Error("bounce"))
      .mockResolvedValueOnce({ data: { id: "email-2" }, error: null });

    await expect(sendClaimSubmittedEmail(opts)).resolves.not.toThrow();

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
