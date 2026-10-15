/**
 * Honesty requirement: this app does not sponsor gas (PEPU's hosted
 * bundler and paymaster are live, but sponsorship needs a project token and
 * this template does not use one). This banner exists so no screen in this app can be mistaken for
 * implying a "gasless" experience — minting is a real transaction, and
 * even a free (`mintPrice == 0`) mint still costs the caller gas. Do not
 * remove it, and do not add a "gasless" badge anywhere else in this app
 * — see AGENTS.md.
 */
export function GasNotice() {
  return (
    <div className="notice notice-honest" role="note">
      <p>
        <strong className="font-semibold text-lime">You pay gas in PEPU.</strong>{" "}
        This app does not sponsor gas — minting costs a small amount of
        real PEPU in gas (typically a fraction of a cent), even if the mint
        price itself is 0. Sponsored transactions are live on Pepe Unchained
        for apps with a funded project, but this template does not use them.
      </p>
    </div>
  );
}
