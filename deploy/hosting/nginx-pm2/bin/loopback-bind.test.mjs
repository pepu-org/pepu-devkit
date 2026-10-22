// Run: node --test deploy/hosting/nginx-pm2/bin/loopback-bind.test.mjs
// Uses ephemeral ports (port 0) only.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { rewriteListenArgs } from "./loopback-bind.mjs";

const preload = new URL("./loopback-bind.mjs", import.meta.url).href;

test("rewriteListenArgs: options form forces host", () => {
  assert.deepEqual(rewriteListenArgs([{ port: 1, host: "0.0.0.0" }], "127.0.0.1"), [{ port: 1, host: "127.0.0.1" }]);
  const cb = () => {};
  assert.deepEqual(rewriteListenArgs([{ port: 1 }, cb], "127.0.0.1"), [{ port: 1, host: "127.0.0.1" }, cb]);
});

test("rewriteListenArgs: port forms", () => {
  const cb = () => {};
  assert.deepEqual(rewriteListenArgs([8788, cb], "127.0.0.1"), [8788, "127.0.0.1", cb]);
  assert.deepEqual(rewriteListenArgs([8788], "127.0.0.1"), [8788, "127.0.0.1"]);
  assert.deepEqual(rewriteListenArgs([8788, "0.0.0.0", cb], "127.0.0.1"), [8788, "127.0.0.1", cb]);
  assert.deepEqual(rewriteListenArgs([8788, "::", 511, cb], "127.0.0.1"), [8788, "127.0.0.1", 511, cb]);
  assert.deepEqual(rewriteListenArgs(["8788"], "127.0.0.1"), ["8788", "127.0.0.1"]);
});

test("rewriteListenArgs: unix sockets and fds are untouched", () => {
  assert.deepEqual(rewriteListenArgs(["/tmp/x.sock"], "127.0.0.1"), ["/tmp/x.sock"]);
  assert.deepEqual(rewriteListenArgs([{ path: "/tmp/x.sock" }], "127.0.0.1"), [{ path: "/tmp/x.sock" }]);
  assert.deepEqual(rewriteListenArgs([{ fd: 3 }], "127.0.0.1"), [{ fd: 3 }]);
});

test("preloaded process binds 127.0.0.1 even when asked for 0.0.0.0 or nothing", () => {
  const script = `
    const http = require("node:http");
    const net = require("node:net");
    const out = [];
    const a = http.createServer().listen({ port: 0, host: "0.0.0.0" }, () => {
      out.push(a.address().address);
      const b = http.createServer().listen(0, () => {
        out.push(b.address().address);
        const c = net.createServer().listen(0, "::", () => {
          out.push(c.address().address);
          console.log(JSON.stringify(out));
          process.exit(0);
        });
      });
    });
  `;
  const r = spawnSync(process.execPath, ["--import", preload, "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), ["127.0.0.1", "127.0.0.1", "127.0.0.1"]);
});

test("PEPU_BIND_HOST overrides the default", () => {
  const script = `const s=require("node:net").createServer().listen(0,()=>{console.log(s.address().address);process.exit(0)})`;
  const r = spawnSync(process.execPath, ["--import", preload, "-e", script], {
    encoding: "utf8",
    env: { ...process.env, PEPU_BIND_HOST: "127.0.0.2" },
  });
  // 127.0.0.2 is loopback on Linux and Windows; some systems (macOS) do not bind it by default.
  if (r.status === 0) assert.equal(r.stdout.trim(), "127.0.0.2");
});

test("importing the module in-process is idempotent", async () => {
  await import("./loopback-bind.mjs");
  const before = net.Server.prototype.listen;
  await import("./loopback-bind.mjs?again");
  assert.equal(net.Server.prototype.listen, before);
  const s = http.createServer();
  await new Promise((r) => s.listen({ port: 0, host: "0.0.0.0" }, r));
  assert.equal(s.address().address, "127.0.0.1");
  s.close();
});
