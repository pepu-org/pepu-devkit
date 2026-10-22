import { describe, expect, it } from "vitest";
import { pepuMainnet } from "../src/index.js";
import { createPepuPrivyConfig } from "../src/privy/config.js";

describe("createPepuPrivyConfig", () => {
  it("is mainnet only, with Coinbase pinned to eoaOnly and createOnLogin off", () => {
    const config = createPepuPrivyConfig();
    expect(config.defaultChain).toBe(pepuMainnet);
    expect(config.supportedChains).toEqual([pepuMainnet]);
    expect(config.supportedChains.map((c) => c.id)).toEqual([97741]);
    expect(config.embeddedWallets.ethereum.createOnLogin).toBe("off");
    expect(config.externalWallets.coinbaseWallet.config.preference.options).toBe("eoaOnly");
  });

  it("passes through optional fields and a createOnLogin override", () => {
    const config = createPepuPrivyConfig({
      loginMethods: ["email", "google"],
      appearance: { theme: "light", accentColor: "#16a34a" },
      createOnLogin: "users-without-wallets",
    });
    expect(config.loginMethods).toEqual(["email", "google"]);
    expect(config.appearance?.accentColor).toBe("#16a34a");
    expect(config.embeddedWallets.ethereum.createOnLogin).toBe("users-without-wallets");
  });

  it("omits loginMethods and appearance when not provided", () => {
    const config = createPepuPrivyConfig();
    expect("loginMethods" in config).toBe(false);
    expect("appearance" in config).toBe(false);
  });
});
