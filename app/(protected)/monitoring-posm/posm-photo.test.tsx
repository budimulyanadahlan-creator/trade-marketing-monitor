import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { PhotoField } = await import("./posm-photo");

afterEach(() => cleanup());

const NO_CHANGE = { file: null, remove: false };

function selectFile(file: File) {
  fireEvent.change(screen.getByLabelText("Pilih foto"), { target: { files: [file] } });
}

describe("PhotoField", () => {
  it("rejects a non-image file with a clear message", () => {
    const onChange = vi.fn();
    render(<PhotoField currentUrl={null} value={NO_CHANGE} onChange={onChange} />);

    selectFile(new File(["x"], "surat.pdf", { type: "application/pdf" }));

    expect(screen.getByText(/JPG atau PNG\./)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("passes a valid image up as the new photo", () => {
    const onChange = vi.fn();
    render(<PhotoField currentUrl={null} value={NO_CHANGE} onChange={onChange} />);

    const file = new File(["x"], "foto.png", { type: "image/png" });
    selectFile(file);

    expect(onChange).toHaveBeenCalledWith({ file, remove: false });
  });

  it("offers removing the current photo", () => {
    const onChange = vi.fn();
    render(<PhotoField currentUrl="https://storage.test/x.jpg" value={NO_CHANGE} onChange={onChange} />);

    expect(screen.getByText("Ganti Foto")).toBeTruthy();
    fireEvent.click(screen.getByText("Hapus Foto"));

    expect(onChange).toHaveBeenCalledWith({ file: null, remove: true });
  });

  it("hides the current photo once marked for removal", () => {
    render(
      <PhotoField currentUrl="https://storage.test/x.jpg" value={{ file: null, remove: true }} onChange={vi.fn()} />
    );

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Foto akan dihapus saat disimpan.")).toBeTruthy();
  });
});
