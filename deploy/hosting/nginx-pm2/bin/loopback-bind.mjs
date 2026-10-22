/**
 * Preload that forces every TCP listener in the process onto the loopback interface.
 *
 * WHY. Neither service lets you choose the bind address:
 *   - Alto 0.0.21 hard-codes host "0.0.0.0" (esm/rpc/server.js, fastify.listen).
 *   - The policy service calls server.listen(port) with no host (binds all interfaces).
 * Behind nginx both must be reachable on 127.0.0.1 ONLY. Alto runs with safe-mode=false, so an
 * exposed 4337 would be an open, unsandboxed bundler. This preload rewrites the host argument of
 * net.Server#listen so the process binds 127.0.0.1 (override with PEPU_BIND_HOST) no matter what
 * the application asked for. Unix-socket and file-descriptor listeners are left alone.
 *
 * Use it as:  node --import /opt/pepu/deploy/hosting/nginx-pm2/bin/loopback-bind.mjs <entry>
 * It is defence in depth, not the only control: ufw must still deny 4337 and 8788 (RUNBOOK).
 * Verify on the host:  ss -ltnp | grep -E ':(4337|8788)\b'   -> every line must show 127.0.0.1.
 */
import net from "node:net";

const HOST = (process.env.PEPU_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const MARK = Symbol.for("pepu.loopbackBind");

/**
 * Rewrites the argument list of net.Server#listen. Exported for the unit test.
 * Handles listen(options[, cb]) and listen(port[, host][, backlog][, cb]).
 */
export function rewriteListenArgs(args, host = HOST) {
  const first = args[0];
  if (first !== null && typeof first === "object") {
    // Options form. Skip IPC (path) and fd listeners.
    if ("path" in first || "fd" in first || "handle" in first) return args;
    return [{ ...first, host }, ...args.slice(1)];
  }
  const isPort =
    typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)) || first === undefined;
  if (!isPort) return args; // listen(path[, cb]) / listen(handle)
  const rest = args.slice(1);
  if (typeof rest[0] === "string") return [first, host, ...rest.slice(1)]; // explicit host: replace it
  return [first, host, ...rest]; // no host given: insert one before backlog/callback
}

if (!net.Server.prototype.listen[MARK]) {
  const original = net.Server.prototype.listen;
  const patched = function listen(...args) {
    return original.apply(this, rewriteListenArgs(args));
  };
  patched[MARK] = true;
  net.Server.prototype.listen = patched;
}
