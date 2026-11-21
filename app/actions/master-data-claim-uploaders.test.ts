import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveClaimDocumentTypeAction } from "./master-data";
import { createClient } from "@/lib/supabase/server";
import { SPECIAL_UPLOADER_MESSAGES } from "@/lib/claim-document-uploaders";

// Pengunggah khusus dokumen klaim — Fase 1
// (plans/plan-pengunggah-khusus-dokumen-klaim.md).

const ADMIN = "99999999-9999-4999-8999-999999999999";
const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NEW_DOC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MERIANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BACKUP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CABANG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Account = {
  id: string;
  role: string;
  is_active: boolean;
  distributor_id: string | null;
  distributor_scope: string | null;
};

const pusat = (id: string, overrides: Partial<Account> = {}): Account => ({
  id,
  role: "distributor",
  is_active: true,
  distributor_id: "edm",
  distributor_scope: "pusat",
  ...overrides,
});

function setupMocks({
  role = "admin",
  accounts = [],
  currentUploaderIds = [],
}: {
  role?: string;
  accounts?: Account[];
  currentUploaderIds?: string[];
} = {}) {
  const docUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const docUpdate = vi.fn().mockReturnValue({ eq: docUpdateEq });
  const docInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: NEW_DOC }, error: null }),
    }),
  });

  const uploaderInsert = vi.fn().mockResolvedValue({ error: null });
  const uploaderDeleteIn = vi.fn().mockResolvedValue({ error: null });
  const uploaderDeleteEq = vi.fn().mockReturnValue({ in: uploaderDeleteIn });
  const uploaderDelete = vi.fn().mockReturnValue({ eq: uploaderDeleteEq });
  const uploaderSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({
      data: currentUploaderIds.map((user_id) => ({ user_id })),
      error: null,
    }),
  });

  const usersIn = vi.fn().mockImplementation((_col: string, ids: string[]) =>
    Promise.resolve({ data: accounts.filter((a) => ids.includes(a.id)), error: null })
  );

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { role, is_active: true } }),
            }),
            in: usersIn,
          }),
        };
      }
      if (table === "claim_document_types") return { update: docUpdate, insert: docInsert };
      if (table === "claim_document_type_uploaders") {
        return { select: uploaderSelect, insert: uploaderInsert, delete: uploaderDelete };
      }
      return {};
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

  return { docUpdate, docInsert, uploaderInsert, uploaderDelete, uploaderDeleteEq, uploaderDeleteIn, uploaderSelect };
}

function form(entries: Record<string, string>, uploaderIds?: string[]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  if (uploaderIds) {
    fd.set("uploaders_included", "1");
    for (const id of uploaderIds) fd.append("uploader_ids", id);
  }
  return fd;
}

const editDoc = { id: DOC, name: "Surat Pengantar Klaim", sort_order: "16" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveClaimDocumentTypeAction — pengunggah khusus", () => {
  it("appoints a Pusat account as special uploader, recording who appointed it", async () => {
    const m = setupMocks({ accounts: [pusat(MERIANA)] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, [MERIANA]));

    expect(result).toEqual({ success: true });
    expect(m.uploaderInsert).toHaveBeenCalledWith([
      { document_type_id: DOC, user_id: MERIANA, created_by: ADMIN },
    ]);
    expect(m.uploaderDelete).not.toHaveBeenCalled();
  });

  it("appoints more than one account", async () => {
    const m = setupMocks({ accounts: [pusat(MERIANA), pusat(BACKUP)] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, [MERIANA, BACKUP]));

    expect(result).toEqual({ success: true });
    expect(m.uploaderInsert).toHaveBeenCalledWith([
      { document_type_id: DOC, user_id: MERIANA, created_by: ADMIN },
      { document_type_id: DOC, user_id: BACKUP, created_by: ADMIN },
    ]);
  });

  it("replaces an appointee: removes the old one, adds the new one", async () => {
    const m = setupMocks({ accounts: [pusat(BACKUP)], currentUploaderIds: [MERIANA] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, [BACKUP]));

    expect(result).toEqual({ success: true });
    expect(m.uploaderDeleteEq).toHaveBeenCalledWith("document_type_id", DOC);
    expect(m.uploaderDeleteIn).toHaveBeenCalledWith("user_id", [MERIANA]);
    expect(m.uploaderInsert).toHaveBeenCalledWith([
      { document_type_id: DOC, user_id: BACKUP, created_by: ADMIN },
    ]);
  });

  it("revokes every appointment when nothing is selected", async () => {
    const m = setupMocks({ currentUploaderIds: [MERIANA] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, []));

    expect(result).toEqual({ success: true });
    expect(m.uploaderDeleteIn).toHaveBeenCalledWith("user_id", [MERIANA]);
    expect(m.uploaderInsert).not.toHaveBeenCalled();
  });

  it("rejects a Cabang account without saving anything", async () => {
    const m = setupMocks({ accounts: [pusat(CABANG, { distributor_scope: "cabang" })] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, [CABANG]));

    expect(result).toEqual({ error: SPECIAL_UPLOADER_MESSAGES.notCandidate });
    expect(m.docUpdate).not.toHaveBeenCalled();
    expect(m.uploaderInsert).not.toHaveBeenCalled();
  });

  it("rejects an inactive account and a non-distributor account", async () => {
    const m = setupMocks({
      accounts: [pusat(MERIANA, { is_active: false }), pusat(BACKUP, { role: "finance" })],
    });

    expect(await saveClaimDocumentTypeAction({}, form(editDoc, [MERIANA]))).toEqual({
      error: SPECIAL_UPLOADER_MESSAGES.notCandidate,
    });
    expect(await saveClaimDocumentTypeAction({}, form(editDoc, [BACKUP]))).toEqual({
      error: SPECIAL_UPLOADER_MESSAGES.notCandidate,
    });
    expect(m.uploaderInsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed account id", async () => {
    const m = setupMocks();

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, ["bukan-uuid"]));

    expect(result.error).toBeTruthy();
    expect(m.docUpdate).not.toHaveBeenCalled();
  });

  it("keeps an already-appointed account that was later deactivated", async () => {
    const m = setupMocks({
      accounts: [pusat(MERIANA, { is_active: false }), pusat(BACKUP)],
      currentUploaderIds: [MERIANA],
    });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, [MERIANA, BACKUP]));

    expect(result).toEqual({ success: true });
    expect(m.uploaderDelete).not.toHaveBeenCalled();
    expect(m.uploaderInsert).toHaveBeenCalledWith([
      { document_type_id: DOC, user_id: BACKUP, created_by: ADMIN },
    ]);
  });

  it("appoints uploaders on a newly created document type", async () => {
    const m = setupMocks({ accounts: [pusat(MERIANA)] });

    const result = await saveClaimDocumentTypeAction(
      {},
      form({ name: "Dokumen Baru", sort_order: "17" }, [MERIANA])
    );

    expect(result).toEqual({ success: true });
    expect(m.docInsert).toHaveBeenCalledWith({ name: "Dokumen Baru", sort_order: 17 });
    expect(m.uploaderInsert).toHaveBeenCalledWith([
      { document_type_id: NEW_DOC, user_id: MERIANA, created_by: ADMIN },
    ]);
  });

  it("leaves appointments untouched when the form does not carry the uploader field", async () => {
    const m = setupMocks({ currentUploaderIds: [MERIANA] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc));

    expect(result).toEqual({ success: true });
    expect(m.docUpdate).toHaveBeenCalledWith({ name: "Surat Pengantar Klaim", sort_order: 16 });
    expect(m.uploaderSelect).not.toHaveBeenCalled();
    expect(m.uploaderDelete).not.toHaveBeenCalled();
    expect(m.uploaderInsert).not.toHaveBeenCalled();
  });

  it("rejects a non-admin user", async () => {
    const m = setupMocks({ role: "distributor", accounts: [pusat(MERIANA)] });

    const result = await saveClaimDocumentTypeAction({}, form(editDoc, [MERIANA]));

    expect(result).toEqual({ error: "Anda tidak memiliki akses." });
    expect(m.uploaderInsert).not.toHaveBeenCalled();
  });
});
