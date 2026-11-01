import { describe, it, expect } from "vitest";
import {
  passwordChangeError,
  PASSWORD_CHANGE_MESSAGES,
  postPasswordChangeRedirect,
} from "./password-change";

describe("passwordChangeError", () => {
  const valid = {
    currentPassword: "lama12345",
    newPassword: "baru12345",
    confirmPassword: "baru12345",
  };

  it("accepts a valid change", () => {
    expect(passwordChangeError(valid)).toBeNull();
  });

  it("rejects empty current password", () => {
    expect(passwordChangeError({ ...valid, currentPassword: "" })).toBe(
      PASSWORD_CHANGE_MESSAGES.currentRequired
    );
  });

  it("rejects new password shorter than 8 characters", () => {
    expect(
      passwordChangeError({ ...valid, newPassword: "baru123", confirmPassword: "baru123" })
    ).toBe(PASSWORD_CHANGE_MESSAGES.tooShort);
  });

  it("rejects new password equal to current password", () => {
    expect(
      passwordChangeError({
        currentPassword: "sama12345",
        newPassword: "sama12345",
        confirmPassword: "sama12345",
      })
    ).toBe(PASSWORD_CHANGE_MESSAGES.sameAsCurrent);
  });

  it("rejects mismatched confirmation", () => {
    expect(passwordChangeError({ ...valid, confirmPassword: "beda12345" })).toBe(
      PASSWORD_CHANGE_MESSAGES.confirmMismatch
    );
  });

  it("treats a missing field as empty", () => {
    expect(
      passwordChangeError({ currentPassword: null, newPassword: null, confirmPassword: null })
    ).toBe(PASSWORD_CHANGE_MESSAGES.currentRequired);
  });
});

describe("postPasswordChangeRedirect", () => {
  it("sends distributors to /campaigns", () => {
    expect(postPasswordChangeRedirect("distributor")).toBe("/campaigns");
  });

  it("sends everyone else to /dashboard", () => {
    expect(postPasswordChangeRedirect("admin")).toBe("/dashboard");
    expect(postPasswordChangeRedirect("user")).toBe("/dashboard");
    expect(postPasswordChangeRedirect(undefined)).toBe("/dashboard");
  });
});
