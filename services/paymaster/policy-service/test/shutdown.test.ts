import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createShutdownHandler } from "../src/shutdown.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

describe("createShutdownHandler", () => {
  it("drains, runs cleanup and exits 0 when there is nothing in flight", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await listen(server);
    const codes: number[] = [];
    const order: string[] = [];
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 1_000,
      onStart: () => void order.push("start"),
      onDrained: () => void order.push("drained"),
      exit: (c) => void codes.push(c),
      log: () => undefined,
    });
    await shutdown("SIGTERM");
    expect(order).toEqual(["start", "drained"]);
    expect(codes).toEqual([0]);
  });

  it("closes idle keep-alive connections immediately instead of waiting for them", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    const port = await listen(server);
    // Open a keep-alive connection and leave it idle.
    const agent = new (await import("node:http")).Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, agent }, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
    const codes: number[] = [];
    const started = Date.now();
    await createShutdownHandler({
      server,
      timeoutMs: 5_000,
      onDrained: () => undefined,
      exit: (c) => void codes.push(c),
      log: () => undefined,
    })("SIGTERM");
    agent.destroy();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(codes).toEqual([0]);
  });

  it("forces exit 1 after the timeout when a request never finishes", async () => {
    const server = createServer(() => {
      /* never respond */
    });
    const port = await listen(server);
    const hung = new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port, method: "POST" });
      req.on("error", () => resolve());
      req.on("close", () => resolve());
      req.end();
    });
    await new Promise((r) => setTimeout(r, 50));
    const codes: number[] = [];
    const logs: string[] = [];
    await createShutdownHandler({
      server,
      timeoutMs: 100,
      onDrained: () => undefined,
      exit: (c) => void codes.push(c),
      log: (m) => void logs.push(m),
    })("SIGTERM");
    await hung;
    expect(codes).toEqual([1]);
    expect(logs.join("\n")).toMatch(/deadline reached/);
  });

  it("ignores a second signal while shutting down", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await listen(server);
    const codes: number[] = [];
    const shutdown = createShutdownHandler({
      server,
      timeoutMs: 1_000,
      onDrained: () => undefined,
      exit: (c) => void codes.push(c),
      log: () => undefined,
    });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(codes).toEqual([0]);
  });

  it("still exits when a cleanup hook throws", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await listen(server);
    const codes: number[] = [];
    await createShutdownHandler({
      server,
      timeoutMs: 1_000,
      onDrained: () => {
        throw new Error("db already closed");
      },
      exit: (c) => void codes.push(c),
      log: () => undefined,
    })("SIGTERM");
    expect(codes).toEqual([0]);
  });
});
