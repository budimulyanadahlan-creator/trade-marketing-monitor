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
      ? [{ id: `f-${id}`, fileName: "bukti.jpg", uploadedBy: "dist-1", uploaderName: "Budi Cabang", uploadedAt: "2026-01-01T00:00:00Z", isLatest: true }]
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

  it("shows who uploaded each claim document file", () => {
    render(section([doc("a", true, true)]));
    expect(screen.getByText("oleh Budi Cabang")).toBeTruthy();
  });

  // Pengunggah Khusus Fase 2 — item terkunci
  const locked = (canUpload: boolean, withFile = false): ClaimDocument => ({
    ...doc("a", withFile, withFile),
    specialUpload: { locked: true, canUpload, canDeleteAny: false },
  });

  it("locked item for a branch account: no Upload button, locked checkbox, 'Diunggah oleh Pusat'", async () => {
    render(section([locked(false), doc("b", false)]));

    expect(screen.getByText("Diunggah oleh Pusat")).toBeTruthy();
    expect(screen.getByText("menunggu Pusat")).toBeTruthy();
    expect(checkbox("a").disabled).toBe(true);
    // Hanya item "b" (tidak terkunci) yang punya tombol Upload.
    expect(screen.getAllByRole("button", { name: /Upload/ })).toHaveLength(1);

    await act(async () => fireEvent.click(checkbox("a")));
    expect(upsert).not.toHaveBeenCalled();
  });

  it("locked item for a branch account still shows the file uploaded by Pusat", () => {
    render(section([locked(false, true)]));

    expect(screen.getByText("bukti.jpg")).toBeTruthy();
    expect(screen.queryByText("menunggu Pusat")).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
  });

  it("locked item for the special uploader: Upload button, checkbox still locked", () => {
    render(section([locked(true)]));

    expect(screen.getByRole("button", { name: /Upload/ })).toBeTruthy();
    expect(checkbox("a").disabled).toBe(true);
    expect(screen.queryByText("Diunggah oleh Pusat")).toBeNull();
  });

  it("reverts the toggle when saving fails", async () => {
    upsert.mockResolvedValue({ error: "Gagal" });
    render(section([doc("a", false)]));

    await act(async () => fireEvent.click(checkbox("a")));

    expect(checkbox("a").checked).toBe(false);
    expect(screen.getByText("0/1 dokumen siap")).toBeTruthy();
  });
});
