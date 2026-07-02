import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function (this: { emails: { send: typeof mockSend } }) {
    this.emails = { send: mockSend };
  }),
}));

import { sendSkpPendingDigestEmail } from "./email";

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
    process.env = { ...originalEnv, RESEND_API_KEY: "re_test_key" };
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
