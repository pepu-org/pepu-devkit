import { describe, expect, it } from "vitest";

const { routes } = await import("./session-routes");

describe("session routes wiring", () => {
  it("mounts the five SDK handlers", () => {
    expect(typeof routes.prepare.POST).toBe("function");
    expect(typeof routes.activate.POST).toBe("function");
    expect(typeof routes.status.GET).toBe("function");
    expect(typeof routes.act.POST).toBe("function");
    expect(typeof routes.revoke.POST).toBe("function");
  });

  it("refuses an unauthenticated request (no Privy token)", async () => {
    const res = await routes.status.GET(new Request("http://app.test/api/session/status"));
    expect(res.ok).toBe(false);
    expect(typeof ((await res.json()) as { error?: unknown }).error).toBe("object");
  });
});
