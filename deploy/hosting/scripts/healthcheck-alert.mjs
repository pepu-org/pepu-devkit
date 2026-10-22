#!/usr/bin/env node
/**
 * External health + deposit alert for the hosted PEPU bundler and v1 paymaster.
 *
 * Runs OUTSIDE the services (cron on the VM, or any other machine) so it still works when
 * they are down, and checks the chain directly so it does not trust the services' own view:
 *
 *   1. bundler (public URL, through Caddy)  eth_chainId == EXPECTED_CHAIN_ID, EntryPoint v0.7 supported
 *   2. paymaster (public URL)               GET /health
 *   3. policy service /ready (loopback)     DB + RPC + deposit as the service sees them (optional)
 *   4. chain RPC                            eth_chainId
 *   5. paymaster EntryPoint deposit         EntryPoint.balanceOf(paymaster) below LOW or above HIGH
 *   6. executor float                       eth_getBalance of each executor address below MIN
 *   7. TLS certificates                     expiry and trust of both public hosts
 *
 * Alerts go to WEBHOOK_URL (Slack / Discord / generic JSON) when the set of failing checks
 * CHANGES, repeat every ALERT_REPEAT_MINUTES while unresolved, and send one RECOVERED message.
 * HEARTBEAT_URL is pinged after every fully green run (dead-man's switch: if this job or the VM dies,
 * the external heartbeat service alerts you). Exit code is 1 when any check failed.
 *
 * Secrets: the RPC URL (embeds a provider key) is read from RPC_URL or RPC_URL_FILE and is only
 * used for requests. It, WEBHOOK_URL and BUNDLER_SHARED_SECRET are never printed; every URL is
 * masked in error text. Zero dependencies, Node >= 18.
 *
 * Configuration is entirely environment variables, see ../monitor.env.example.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import tls from "node:tls";

const HEX_PAD = (s) => s.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** Masks every URL so provider keys and webhook tokens cannot leak through error text. */
export function redact(text) {
  return String(text).replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, "<url>");
}

export function loadConfig(env = process.env, readFile = (p) => readFileSync(p, "utf8")) {
  let rpcUrl = env.RPC_URL?.trim() || "";
  if (!rpcUrl && env.RPC_URL_FILE?.trim()) {
    try {
      rpcUrl = readFile(env.RPC_URL_FILE.trim()).trim();
    } catch {
      rpcUrl = "";
    }
  }
  const big = (name, fallback) => {
    const raw = env[name]?.trim();
    return raw ? BigInt(raw) : fallback;
  };
  return {
    label: env.ALERT_LABEL?.trim() || "pepu-hosting",
    bundlerUrl: env.PUBLIC_BUNDLER_URL?.trim() || "",
    paymasterUrl: env.PUBLIC_PAYMASTER_URL?.trim() || "",
    bundlerSecret: env.BUNDLER_SHARED_SECRET?.trim() || "",
    readyUrl: env.POLICY_READY_URL?.trim() || "",
    rpcUrl,
    expectedChainId: Number(env.EXPECTED_CHAIN_ID?.trim() || "97741"),
    entryPoint: env.ENTRY_POINT_ADDRESS?.trim() || "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    paymaster: env.PAYMASTER_ADDRESS?.trim() || "",
    executors: (env.EXECUTOR_ADDRESSES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    depositLowWei: big("DEPOSIT_LOW_WEI", 0n),
    depositHighWei: big("DEPOSIT_HIGH_WEI", 0n),
    executorMinWei: big("EXECUTOR_MIN_WEI", 0n),
    certMinDays: Number(env.CERT_MIN_DAYS?.trim() || "14"),
    webhookUrl: env.WEBHOOK_URL?.trim() || "",
    webhookFormat: (env.WEBHOOK_FORMAT?.trim() || "slack").toLowerCase(),
    repeatMinutes: Number(env.ALERT_REPEAT_MINUTES?.trim() || "60"),
    heartbeatUrl: env.HEARTBEAT_URL?.trim() || "",
    stateFile: env.STATE_FILE?.trim() || "/state/alert-state.json",
    timeoutMs: Number(env.CHECK_TIMEOUT_MS?.trim() || "10000"),
  };
}

async function jsonRpc(fetchImpl, url, method, params, timeoutMs, headers = {}) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`rpc error ${body.error.code ?? ""} ${body.error.message ?? ""}`.trim());
  return body.result;
}

/** Days until the TLS certificate of `host:443` expires, plus whether the chain is trusted. */
export function inspectCertificate(host, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const result = {
        authorized: socket.authorized,
        authError: socket.authorizationError ? String(socket.authorizationError) : null,
        daysLeft: cert && cert.valid_to ? (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000 : NaN,
      };
      socket.end();
      resolve(result);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("TLS connect timed out"));
    });
    socket.on("error", reject);
  });
}

/**
 * Runs every configured check. `deps` lets tests inject fetch and the certificate inspector.
 * Returns [{ name, ok, detail }]. A check that throws is a failed check, never a crash.
 */
export async function runChecks(config, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const inspectCert = deps.inspectCertificate ?? inspectCertificate;
  const results = [];
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail ?? "ok" });
    } catch (error) {
      results.push({ name, ok: false, detail: redact(error instanceof Error ? error.message : error).slice(0, 300) });
    }
  };
  const t = config.timeoutMs;
  const bundlerHeaders = config.bundlerSecret ? { "x-pepu-bundler-key": config.bundlerSecret } : {};

  if (config.bundlerUrl) {
    await check("bundler_chain_id", async () => {
      const id = Number(BigInt(await jsonRpc(fetchImpl, config.bundlerUrl, "eth_chainId", [], t, bundlerHeaders)));
      if (id !== config.expectedChainId) throw new Error(`chainId ${id}, expected ${config.expectedChainId}`);
      return `chainId ${id}`;
    });
    await check("bundler_entrypoints", async () => {
      const eps = await jsonRpc(fetchImpl, config.bundlerUrl, "eth_supportedEntryPoints", [], t, bundlerHeaders);
      if (!Array.isArray(eps) || !eps.some((e) => String(e).toLowerCase() === config.entryPoint.toLowerCase())) {
        throw new Error(`EntryPoint ${config.entryPoint} not in supportedEntryPoints`);
      }
      return `${eps.length} entry point(s)`;
    });
  }

  if (config.paymasterUrl) {
    await check("paymaster_health", async () => {
      const res = await fetchImpl(new URL("/health", config.paymasterUrl), { signal: AbortSignal.timeout(t) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.status !== "ok") throw new Error("health status is not ok");
      return "ok";
    });
  }

  if (config.readyUrl) {
    await check("policy_ready", async () => {
      const res = await fetchImpl(config.readyUrl, { signal: AbortSignal.timeout(t) });
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (res.status !== 200 || body?.status !== "ready") {
        const failed = body?.checks
          ? Object.entries(body.checks)
              .filter(([, v]) => v && v.ok === false)
              .map(([k, v]) => `${k}: ${v.detail ?? "failed"}`)
              .join("; ")
          : "";
        throw new Error(`/ready returned HTTP ${res.status}${failed ? ` (${failed})` : ""}`);
      }
      const warn = Array.isArray(body.warnings) && body.warnings.length ? ` warnings: ${body.warnings.join("; ")}` : "";
      return `ready${warn}`;
    });
  }

  if (config.rpcUrl) {
    await check("chain_rpc", async () => {
      const id = Number(BigInt(await jsonRpc(fetchImpl, config.rpcUrl, "eth_chainId", [], t)));
      if (id !== config.expectedChainId) throw new Error(`chainId ${id}, expected ${config.expectedChainId}`);
      return `chainId ${id}`;
    });

    if (config.paymaster) {
      await check("paymaster_deposit", async () => {
        const data = `0x70a08231${HEX_PAD(config.paymaster)}`; // balanceOf(address)
        const hex = await jsonRpc(fetchImpl, config.rpcUrl, "eth_call", [{ to: config.entryPoint, data }, "latest"], t);
        const wei = BigInt(hex);
        if (config.depositLowWei > 0n && wei < config.depositLowWei) {
          throw new Error(`deposit ${wei} wei is BELOW the low mark ${config.depositLowWei}: top it up`);
        }
        if (config.depositHighWei > 0n && wei > config.depositHighWei) {
          throw new Error(`deposit ${wei} wei is ABOVE the ceiling ${config.depositHighWei}: more at risk than intended`);
        }
        return `deposit ${wei} wei`;
      });
    }

    for (const address of config.executors) {
      await check(`executor_balance_${address.slice(0, 8).toLowerCase()}`, async () => {
        const wei = BigInt(await jsonRpc(fetchImpl, config.rpcUrl, "eth_getBalance", [address, "latest"], t));
        if (config.executorMinWei > 0n && wei < config.executorMinWei) {
          throw new Error(`executor ${address} balance ${wei} wei is below ${config.executorMinWei}: fund it`);
        }
        return `${address} ${wei} wei`;
      });
    }
  } else if (config.paymaster || config.executors.length) {
    results.push({ name: "chain_rpc", ok: false, detail: "RPC_URL / RPC_URL_FILE not available: on-chain checks cannot run" });
  }

  for (const [label, url] of [
    ["bundler", config.bundlerUrl],
    ["paymaster", config.paymasterUrl],
  ]) {
    if (!url || !url.startsWith("https://")) continue;
    await check(`cert_${label}`, async () => {
      const { hostname } = new URL(url);
      const cert = await inspectCert(hostname, t);
      if (!cert.authorized) throw new Error(`certificate for ${hostname} is not trusted (${cert.authError ?? "unknown"})`);
      if (Number.isNaN(cert.daysLeft)) throw new Error(`could not read certificate expiry for ${hostname}`);
      if (cert.daysLeft < config.certMinDays) {
        throw new Error(`certificate for ${hostname} expires in ${cert.daysLeft.toFixed(1)} days (auto-renewal is not working?)`);
      }
      return `${cert.daysLeft.toFixed(0)} days left`;
    });
  }

  return results;
}

/** Pure alert-state transition. Returns what to send and the next state. */
export function evaluateAlerts(results, state, nowMs, repeatMinutes) {
  const failing = results.filter((r) => !r.ok);
  const key = failing.map((r) => r.name).sort().join(",");
  const prev = { key: state?.key ?? "", lastSentMs: state?.lastSentMs ?? 0 };
  if (failing.length > 0) {
    const changed = key !== prev.key;
    const due = nowMs - prev.lastSentMs >= repeatMinutes * 60_000;
    if (changed || due) return { send: "alert", failing, nextState: { key, lastSentMs: nowMs }, prevState: prev };
    return { send: null, failing, nextState: prev, prevState: prev };
  }
  if (prev.key) return { send: "recovered", failing, nextState: { key: "", lastSentMs: nowMs }, prevState: prev };
  return { send: null, failing, nextState: prev, prevState: prev };
}

export function buildMessage(kind, label, results) {
  const failing = results.filter((r) => !r.ok);
  if (kind === "recovered") return `[${label}] RECOVERED: all checks pass again (${results.length} checks).`;
  const lines = failing.map((r) => `- ${r.name}: ${r.detail}`);
  return `[${label}] ALERT: ${failing.length} check(s) failing\n${lines.join("\n")}`;
}

export async function sendWebhook(config, message, results, fetchImpl = fetch) {
  if (!config.webhookUrl) return;
  let payload;
  if (config.webhookFormat === "discord") payload = { content: message.slice(0, 1900) };
  else if (config.webhookFormat === "generic") payload = { text: message, content: message, results };
  else payload = { text: message };
  const res = await fetchImpl(config.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`webhook returned HTTP ${res.status}`);
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { key: "", lastSentMs: 0 };
  }
}

function writeState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
  } catch (error) {
    console.error(`could not write state file: ${redact(error.message)}`);
  }
}

/** One full run. Returns { exitCode, results }. */
export async function main(env = process.env, deps = {}) {
  const config = loadConfig(env);
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now();
  const log = deps.log ?? ((m) => console.log(m));

  const results = await runChecks(config, deps);
  for (const r of results) log(`${r.ok ? "OK  " : "FAIL"} ${r.name}: ${r.detail}`);

  const state = readState(config.stateFile);
  const decision = evaluateAlerts(results, state, now, config.repeatMinutes);
  let nextState = decision.nextState;
  if (decision.send) {
    try {
      await sendWebhook(config, buildMessage(decision.send, config.label, results), results, fetchImpl);
    } catch (error) {
      console.error(`alert delivery failed (will retry next run): ${redact(error.message)}`);
      nextState = decision.prevState; // keep the old state so the next run tries again
    }
  }
  writeState(config.stateFile, nextState);

  const failed = results.some((r) => !r.ok);
  if (!failed && config.heartbeatUrl) {
    try {
      await fetchImpl(config.heartbeatUrl, { signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (error) {
      console.error(`heartbeat ping failed: ${redact(error.message)}`);
    }
  }
  return { exitCode: failed ? 1 : 0, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    ({ exitCode }) => process.exit(exitCode),
    (error) => {
      console.error(`monitor crashed: ${redact(error?.message ?? error)}`);
      process.exit(2);
    },
  );
}
