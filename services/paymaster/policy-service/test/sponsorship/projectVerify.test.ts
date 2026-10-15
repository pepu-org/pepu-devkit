/**
 * Unit tests for the Privy secret check and the EIP-712 claim attestation signer.
 */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createPrivyRestSecretVerifier, signClaimAttestation } from "../../src/sponsorship/projectVerify.js";

const SECRET = "super-secret-app-secret-xyz";

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {})) as typeof fetch;
}

describe("createPrivyRestSecretVerifier", () => {
  it("sends Basic appId:secret + privy-app-id to GET /v1/users?limit=1 and maps 200 -> valid", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const v = createPrivyRestSecretVerifier({
      baseUrl: "https://api.privy.test",
      fetchImpl: fakeFetch((url, init) => {
        seen = { url, headers: init.headers as Record<string, string> };
        return new Response("{}", { status: 200 });
      }),
    });
    expect(await v.verify("app123", SECRET)).toBe("valid");
    expect(seen!.url).toBe("https://api.privy.test/v1/users?limit=1");
    expect(seen!.headers["privy-app-id"]).toBe("app123");
    expect(seen!.headers.Authorization).toBe(`Basic ${Buffer.from(`app123:${SECRET}`).toString("base64")}`);
  });

  it("maps 401/403 -> invalid and anything else -> a secret-free error", async () => {
    for (const status of [401, 403]) {
      const v = createPrivyRestSecretVerifier({ fetchImpl: fakeFetch(() => new Response("no", { status })) });
      expect(await v.verify("a", SECRET)).toBe("invalid");
    }
    for (const status of [400, 404, 429, 500, 503]) {
      const v = createPrivyRestSecretVerifier({ fetchImpl: fakeFetch(() => new Response("x", { status })) });
      await expect(v.verify("a", SECRET)).rejects.toThrow("privy_unexpected_response");
    }
  });

  it("network failures throw a fixed message that does not contain the secret or the original error", async () => {
    const v = createPrivyRestSecretVerifier({
      fetchImpl: fakeFetch(() => {
        throw new Error(`socket hang up, auth header was Basic ${Buffer.from(`a:${SECRET}`).toString("base64")} ${SECRET}`);
      }),
    });
    const err = await v.verify("a", SECRET).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("privy_unreachable");
    expect(String((err as Error).stack)).not.toContain(SECRET);
  });
});

describe("signClaimAttestation", () => {
  // Frozen vector: signed with anvil key #0 for chain 97741 and a paymaster at 0x...0a55. The Foundry test
  // PepuSponsoredHashCrossCheck.t.sol (test_ClaimAttestation_FromPolicyService_IsAccepted) feeds the SAME signature
  // to the real contract and requires claimProject to accept it.
  const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  it("matches the frozen vector the contract accepts", async () => {
    const a = await signClaimAttestation({
      signer: privateKeyToAccount(KEY),
      chainId: 97741,
      paymaster: "0x0000000000000000000000000000000000000a55",
      appId: "cm-vector-app",
      newOwner: "0x00000000000000000000000000000000000000a1",
      deadlineSeconds: 1_800_003_600,
      nonce: 42n,
    });
    expect(a.signature).toBe(
      "0x764f792a55e35a204ed6c974e7f6bf6c7dea3d9cccb335645e5155dca5b9ed1f482647906ebefae1d0267600b773d3f66af1c2ad5ca9e77ffd417c95779741401b",
    );
    expect(a.nonce).toBe("42");
    expect(a.deadline).toBe("1800003600");
  });
});
