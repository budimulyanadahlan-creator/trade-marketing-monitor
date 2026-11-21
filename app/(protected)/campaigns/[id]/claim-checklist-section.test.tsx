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

// Pengunggah Khusus Fase 3 — pengunggah khusus di SKP yang hanya bisa ia lihat
// (SKP anak perusahaan / klaim turunan milik akun lain): canAct = false.
describe("ClaimChecklistSection — pengunggah khusus dengan akses hanya lihat", () => {
  const viewOnly = (documents: ClaimDocument[]) => (
    <ClaimChecklistSection
      campaignId="camp-1"
      campaignStatus="ongoing"
      userRole="distributor"
      userId="dist-1"
      documents={documents}
      claimAmount={null}
      claimAmountVerification={null}
      canAct={false}
    />
  );
  const lockedDoc = (canUpload: boolean, withFile = false): ClaimDocument => ({
    ...doc("a", withFile, withFile),
    specialUpload: { locked: true, canUpload, canDeleteAny: false },
  });
  const buttons = () => screen.queryAllByRole("button");

  it("only the locked row is active: one Upload button, nothing for other documents", () => {
    render(viewOnly([lockedDoc(true), doc("b", false)]));

    expect(screen.getAllByRole("button", { name: /Upload/ })).toHaveLength(1);
    expect(screen.queryByText("Diunggah oleh Pusat")).toBeNull();
    // Tidak ada kotak centang yang bisa diubah di SKP hanya-lihat.
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });

  it("can delete their own file on the locked row", () => {
    render(viewOnly([lockedDoc(false, true)]));
    const withoutReach = buttons().length;
    cleanup();

    render(viewOnly([lockedDoc(true, true)]));
    // Upload + hapus file miliknya.
    expect(buttons().length).toBe(withoutReach + 2);
  });

  it("a view-only Pusat account that is not the special uploader gets no Upload at all", () => {
    render(viewOnly([lockedDoc(false), doc("b", false)]));

    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
    expect(screen.getByText("Diunggah oleh Pusat")).toBeTruthy();
  });
});

// Pengunggah Khusus Fase 4 — sesudah klaim diajukan: pengunggah khusus tetap
// bisa mengunggah / mengganti / menghapus selama item belum Accept.
describe("ClaimChecklistSection — item terkunci sesudah klaim diajukan", () => {
  const submitted = (
    documents: ClaimDocument[],
    campaignStatus: "claim_submitted" | "claim_verified" = "claim_submitted",
    canAct = false
  ) => (
    <ClaimChecklistSection
      campaignId="camp-1"
      campaignStatus={campaignStatus}
      userRole="distributor"
      userId="dist-1"
      documents={documents}
      claimAmount={null}
      claimAmountVerification={null}
      canAct={canAct}
    />
  );
  const lockedDoc = (
    canUpload: boolean,
    status: "pending" | "accepted" | "revision_requested" | null,
    withFile = false
  ): ClaimDocument => ({
    ...doc("a", withFile, withFile),
    specialUpload: { locked: true, canUpload, canDeleteAny: false },
    verification: status
      ? { id: "item-a", status, note: null, actorName: null, decidedAt: null }
      : null,
  });
  const uploadButtons = () => screen.queryAllByRole("button", { name: /Upload/ });

  it("special uploader keeps Upload while the item is pending, empty, or sent back for revision", () => {
    for (const status of ["pending", "revision_requested", null] as const) {
      render(submitted([lockedDoc(true, status)]));
      expect(uploadButtons()).toHaveLength(1);
      cleanup();
    }
  });

  it("special uploader can delete their own file while the item is not accepted", () => {
    render(submitted([lockedDoc(true, "accepted", true)]));
    const whenAccepted = screen.queryAllByRole("button").length;
    cleanup();

    render(submitted([lockedDoc(true, "pending", true)]));
    // Upload + hapus file miliknya.
    expect(screen.queryAllByRole("button").length).toBe(whenAccepted + 2);
  });

  it("locks the row once Finance accepted the item, and after the claim is verified", () => {
    render(submitted([lockedDoc(true, "accepted", true)]));
    expect(uploadButtons()).toHaveLength(0);
    cleanup();

    render(submitted([lockedDoc(true, "pending", true)], "claim_verified"));
    expect(uploadButtons()).toHaveLength(0);
  });

  it("the branch claim holder gets no Upload on a locked item, even when revision is requested", () => {
    render(submitted([lockedDoc(false, "revision_requested")], "claim_submitted", true));

    expect(uploadButtons()).toHaveLength(0);
    expect(screen.getByText("Diunggah oleh Pusat")).toBeTruthy();
  });

  it("unlocked items keep the old rule: re-upload only while revision is requested", () => {
    const plain = (status: "pending" | "revision_requested"): ClaimDocument => ({
      ...doc("b", false),
      verification: { id: "item-b", status, note: null, actorName: null, decidedAt: null },
    });

    render(submitted([plain("pending")], "claim_submitted", true));
    expect(uploadButtons()).toHaveLength(0);
    cleanup();

    render(submitted([plain("revision_requested")], "claim_submitted", true));
    expect(uploadButtons()).toHaveLength(1);
  });
});

// Pengunggah Khusus Fase 5 — panel verifikasi Finance untuk item terkunci.
describe("ClaimChecklistSection — verifikasi Finance atas item terkunci", () => {
  const forRole = (
    documents: ClaimDocument[],
    userRole: "finance" | "admin" | "distributor" = "finance"
  ) => (
    <ClaimChecklistSection
      campaignId="camp-1"
      campaignStatus="claim_submitted"
      userRole={userRole}
      userId="user-1"
      documents={documents}
      claimAmount={null}
      claimAmountVerification={null}
    />
  );
  const item = (
    isLocked: boolean,
    withFile: boolean,
    status: "pending" | "accepted" | "revision_requested" = "pending"
  ): ClaimDocument => ({
    ...doc("a", withFile, withFile),
    ...(isLocked
      ? { specialUpload: { locked: true, canUpload: false, canDeleteAny: false } }
      : {}),
    verification: { id: "item-a", status, note: null, actorName: null, decidedAt: null },
  });
  const accept = () => screen.getByRole("button", { name: "Terima" }) as HTMLButtonElement;
  const revisi = () => screen.getByRole("button", { name: "Minta Revisi" }) as HTMLButtonElement;

  it("locked item without a file: 'Menunggu dari Pusat', Accept disabled, Minta Revisi still enabled", () => {
    render(forRole([item(true, false)]));

    expect(screen.getByText("Menunggu dari Pusat")).toBeTruthy();
    expect(accept().disabled).toBe(true);
    expect(revisi().disabled).toBe(false);
  });

  it("locked item with a file: Accept enabled, no waiting label, uploader name shown", () => {
    render(forRole([item(true, true)]));

    expect(screen.queryByText("Menunggu dari Pusat")).toBeNull();
    expect(accept().disabled).toBe(false);
    expect(screen.getByText(/oleh Budi Cabang/)).toBeTruthy();
  });

  it("unlocked item without a file keeps the old rule: Accept enabled, no label", () => {
    render(forRole([item(false, false)]));

    expect(screen.queryByText("Menunggu dari Pusat")).toBeNull();
    expect(accept().disabled).toBe(false);
  });

  it("admin gets the same disabled Accept on an empty locked item", () => {
    render(
      forRole(
        [{ ...item(true, false), specialUpload: { locked: true, canUpload: true, canDeleteAny: true } }],
        "admin"
      )
    );

    expect(screen.getByText("Menunggu dari Pusat")).toBeTruthy();
    expect(accept().disabled).toBe(true);
  });

  it("the branch view is unchanged: 'menunggu Pusat' next to the document, no Finance label", () => {
    render(forRole([item(true, false)], "distributor"));

    expect(screen.queryByText("Menunggu dari Pusat")).toBeNull();
    expect(screen.getByText("menunggu Pusat")).toBeTruthy();
  });
});
