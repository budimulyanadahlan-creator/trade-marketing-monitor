import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ClaimDocument } from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// Diimpor tidak langsung lewat server action lain; butuh API key saat dimuat.
vi.mock("@/lib/email", () => ({}));
vi.mock("@/app/actions/claim-checklist", () => ({ upsertClaimChecklistAction: vi.fn() }));

const { ClaimChecklistSection } = await import("./campaign-detail-client");
const { upsertClaimChecklistAction } = await import("@/app/actions/claim-checklist");
const upsert = upsertClaimChecklistAction as ReturnType<typeof vi.fn>;

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

function doc(id: string, isFulfilled: boolean, withFile = false): ClaimDocument {
  return {
    documentTypeId: id,
    name: `Dokumen ${id}`,
    isFulfilled,
    files: withFile
      ? [{ id: `f-${id}`, fileName: "bukti.jpg", uploadedBy: "dist-1", uploadedAt: "2026-01-01T00:00:00Z", isLatest: true }]
      : [],
    verification: null,
  };
}

function section(documents: ClaimDocument[]) {
  return (
    <ClaimChecklistSection
      campaignId="camp-1"
      campaignStatus="ongoing"
      userRole="distributor"
      userId="dist-1"
      documents={documents}
      claimAmount={null}
      claimAmountVerification={null}
    />
  );
}

const checkbox = (id: string) =>
  screen.getByText(`Dokumen ${id}`).closest("label")!.querySelector("input") as HTMLInputElement;

describe("ClaimChecklistSection", () => {
  it("resyncs with fresh server data after an upload (auto-fulfilled item)", () => {
    const { rerender } = render(section([doc("a", false), doc("b", false)]));
    expect(screen.getByText("0/2 dokumen siap")).toBeTruthy();

    rerender(section([doc("a", true, true), doc("b", false)]));

    expect(screen.getByText("1/2 dokumen siap")).toBeTruthy();
    expect(checkbox("a").checked).toBe(true);
  });

  it("shows a manual toggle immediately, then follows the refreshed server data", async () => {
    upsert.mockResolvedValue({});
    const { rerender } = render(section([doc("a", false), doc("b", false)]));

    await act(async () => fireEvent.click(checkbox("a")));
    expect(checkbox("a").checked).toBe(true);
    expect(screen.getByText("1/2 dokumen siap")).toBeTruthy();
    expect(upsert).toHaveBeenCalledWith("camp-1", "a", true);

    // Server says otherwise (e.g. the last file was removed elsewhere).
    rerender(section([doc("a", false), doc("b", false)]));
    expect(checkbox("a").checked).toBe(false);
  });

  it("reverts the toggle when saving fails", async () => {
    upsert.mockResolvedValue({ error: "Gagal" });
    render(section([doc("a", false)]));

    await act(async () => fireEvent.click(checkbox("a")));

    expect(checkbox("a").checked).toBe(false);
    expect(screen.getByText("0/1 dokumen siap")).toBeTruthy();
  });
});
