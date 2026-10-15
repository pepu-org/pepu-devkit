/**
 * Honesty requirement: gas sponsorship does not exist on Pepe Unchained
 * yet, and a session signer does not change that — it removes the wallet
 * *popup*, not the *cost*. This banner exists so no screen in this app
 * can be mistaken for implying a "gasless" experience. Do not remove it,
 * and do not add a "gasless" badge anywhere else in this app — see
 * AGENTS.md.
 */
export function GasNotice() {
  return (
    <div className="notice notice-honest" role="note">
      <p>
        <strong className="font-semibold text-lime">
          You still pay gas in PEPU.
        </strong>{" "}
        A session signer removes the wallet popup for each move — it does
        not remove the cost. Gas sponsorship isn&apos;t available on Pepe
        Unchained yet, so every tap below costs a small amount of real
        PEPU (typically a fraction of a cent), charged to whichever
        wallet is active for actions — see the wallet card above.
      </p>
    </div>
  );
}
