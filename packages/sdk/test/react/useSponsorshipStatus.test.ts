// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSponsorshipStatus } from "../../src/react/useSponsorshipStatus.js";

afterEach(cleanup);

describe("useSponsorshipStatus", () => {
  it("always reports gas sponsorship as unavailable, with a reason", () => {
    const { result } = renderHook(() => useSponsorshipStatus());
    expect(result.current.available).toBe(false);
    expect(result.current.reason.length).toBeGreaterThan(0);
    expect(result.current.bundlerUrl).toBeUndefined();
  });

  it("still reports unavailable when a future bundlerUrl extension point is passed", () => {
    const { result } = renderHook(() =>
      useSponsorshipStatus({ bundlerUrl: "https://future-bundler.example.com" }),
    );
    expect(result.current.available).toBe(false);
    expect(result.current.bundlerUrl).toBe("https://future-bundler.example.com");
  });
});
