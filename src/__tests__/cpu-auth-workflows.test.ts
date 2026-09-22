import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAllUsers, getUserByUsername, getAuthSession } = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  getUserByUsername: vi.fn(),
  getAuthSession: vi.fn(),
}));

vi.mock("@/db/queries", () => ({ getAllUsers, getUserByUsername }));
vi.mock("@/lib/authSession", () => ({ getAuthSession }));

import { authenticateKitchen, hashPassword } from "@/lib/auth";

describe("authenticateKitchen workflows", () => {
  const env = { admin: process.env.ADMIN_PASSWORD, manager: process.env.MANAGER_PASSWORD };

  beforeEach(() => {
    getAllUsers.mockReset();
    getUserByUsername.mockReset();
    getAuthSession.mockReset();
    delete process.env.ADMIN_PASSWORD;
    delete process.env.MANAGER_PASSWORD;
  });

  afterEach(() => {
    process.env.ADMIN_PASSWORD = env.admin;
    process.env.MANAGER_PASSWORD = env.manager;
  });

  it("uses the requested session scope for empty-password authentication", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    getAuthSession.mockResolvedValue({ role: "staff", displayName: "Cook" });
    expect(await authenticateKitchen("")).toEqual({ role: "staff", displayName: "Cook" });
    expect(await authenticateKitchen("", "admin")).toEqual({ role: "staff", displayName: "Cook" });
    expect(getAuthSession).toHaveBeenNthCalledWith(1, "kitchen");
    expect(getAuthSession).toHaveBeenNthCalledWith(2, "admin");
    expect(getAllUsers).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("returns env admin/manager before any hash or DB read", async () => {
    process.env.ADMIN_PASSWORD = "env-admin";
    process.env.MANAGER_PASSWORD = "env-mgr";
    const digest = vi.spyOn(crypto.subtle, "digest");
    expect(await authenticateKitchen("env-admin")).toEqual({ role: "admin", displayName: "Admin" });
    expect(await authenticateKitchen("env-mgr")).toEqual({ role: "manager", displayName: "Manager" });
    expect(getAllUsers).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("hashes once even when many staff rows exist", async () => {
    const secret = "kitchen-staff-pw";
    const hash = await hashPassword(secret);
    getAllUsers.mockResolvedValue([
      { passwordHash: "aaa", role: "staff", displayName: "A", username: "a" },
      { passwordHash: "bbb", role: "staff", displayName: "B", username: "b" },
      { passwordHash: hash, role: "staff", displayName: "Cook", username: "cook" },
      { passwordHash: hash, role: "manager", displayName: "Second match", username: "two" },
    ]);
    const digest = vi.spyOn(crypto.subtle, "digest");
    expect(await authenticateKitchen(secret)).toEqual({ role: "staff", displayName: "Cook" });
    expect(digest).toHaveBeenCalledTimes(1);
    expect(getAllUsers).toHaveBeenCalledTimes(1);
    digest.mockRestore();
  });

  it("uses a Cloudflare Workers-compatible PBKDF2 iteration count", async () => {
    const hash = await hashPassword("worker-compatible-pw");
    expect(hash.split("$").slice(0, 3)).toEqual(["pbkdf2", "1", "100000"]);
  });

  it("falls back to staff role and username when those fields are empty", async () => {
    const secret = "plain";
    getAllUsers.mockResolvedValue([
      { passwordHash: await hashPassword(secret), role: "", displayName: "", username: "lin" },
    ]);
    expect(await authenticateKitchen(secret)).toEqual({ role: "staff", displayName: "lin" });
  });

  it("returns null on wrong password and when getAllUsers throws", async () => {
    getAllUsers.mockResolvedValue([{ passwordHash: "nope", role: "staff", displayName: "X", username: "x" }]);
    expect(await authenticateKitchen("wrong")).toBeNull();
    getAllUsers.mockRejectedValue(new Error("d1 down"));
    expect(await authenticateKitchen("wrong")).toBeNull();
  });
});
