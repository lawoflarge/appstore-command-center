import type { SubscriptionSnapshot } from "@/lib/store/paths";

export function ActiveSubscriptions({ snapshot }: { snapshot: SubscriptionSnapshot | null }) {
  const products = snapshot?.products ?? [];
  const count = (key: keyof NonNullable<SubscriptionSnapshot>["products"][number]["counts"]) =>
    products.reduce((sum, product) => sum + product.counts[key], 0);
  const asOf = snapshot ? new Date(`${snapshot.reportDate}T12:00:00Z`)
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <section aria-labelledby="active-subscriptions-heading" className="mb-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="active-subscriptions-heading" className="text-xl font-semibold tracking-tight">Active subscriptions</h2>
          <p className="mt-1 text-xs text-[var(--ink-2)]">Latest available Apple snapshot, independent of the selected revenue month.</p>
        </div>
        {asOf && <p className="text-xs font-medium text-[var(--ink-2)]">As of {asOf}</p>}
      </div>
      {!snapshot ? (
        <div className="glass p-6">
          <p className="text-sm font-medium">No subscription snapshot available yet</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">Active subscriptions cannot be calculated from monthly sales. This section will show Apple&apos;s subscription report once it has been collected.</p>
        </div>
      ) : (
        <div className="glass overflow-hidden">
          <div className="grid grid-cols-2 gap-4 border-b border-[var(--chart-grid)] p-5 sm:grid-cols-4">
            {[
              ["Paid subscriptions", count("standardPrice") + count("paidOffer")],
              ["Free trials", count("freeTrial")],
              ["In grace period", count("gracePeriod")],
              ["In billing retry", count("billingRetry")],
            ].map(([label, value]) => <div key={label}><p className="text-xs text-[var(--ink-2)]">{label}</p><p className="num mt-1 text-2xl font-semibold">{Number(value).toLocaleString()}</p></div>)}
          </div>
          {products.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[740px] text-left text-sm">
                <caption className="sr-only">Subscription counts by app and product as of {asOf}</caption>
                <thead className="border-b border-[var(--chart-grid)] bg-white/25 text-xs text-[var(--ink-2)]">
                  <tr><th scope="col" className="px-5 py-3 font-medium">App / product</th>{["Standard paid", "Paid offers", "Free trials", "Grace", "Retry", "Marketing opt-in"].map((label) => <th scope="col" key={label} className="px-3 py-3 text-right font-medium">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-[var(--chart-grid)]">
                  {products.map((product) => (
                    <tr key={`${product.appAppleId}:${product.subscriptionAppleId}`} className="hover:bg-white/30">
                      <th scope="row" className="px-5 py-4 font-normal"><p className="font-semibold">{product.appName}</p><p className="mt-1 text-xs text-[var(--ink-2)]">{product.subscriptionName} · {product.duration}</p></th>
                      {(["standardPrice", "paidOffer", "freeTrial", "gracePeriod", "billingRetry", "marketingOptIn"] as const).map((key) => <td key={key} className="num px-3 py-4 text-right">{product.counts[key].toLocaleString()}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="p-5 text-sm text-[var(--ink-2)]">Apple&apos;s latest report contains no subscription products.</p>}
          <p className="border-t border-[var(--chart-grid)] px-5 py-4 text-xs leading-relaxed text-[var(--ink-2)]">Aggregated subscriptions, not individual subscribers. Paid subscriptions combine standard-price and paid-offer counts. Grace, retry and marketing opt-in are separate reported counts and are not added to the paid total.</p>
        </div>
      )}
    </section>
  );
}
