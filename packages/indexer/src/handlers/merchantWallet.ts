/**
 * Merchant accounts: the stablecoin moving in and out of them.
 *
 * Every account the indexer meets as a merchant (registered, paid, quoted, or
 * publishing a subscription plan) is registered at runtime as a
 * `MerchantWallet`. The Transfer handler runs in wildcard mode, filtered at
 * the source (HyperSync topics) to transfers from or to those accounts, and
 * keeps only the stablecoin's.
 *
 * That gives the dashboard a balance without an RPC call, and makes payouts
 * visible: a transfer out of a merchant account in a transaction sent to the
 * stablecoin itself (the relayer carrying the merchant's signed
 * transferWithAuthorization) is a payout. Money leaving through a Polaris
 * contract (a checkout payment, a send) is not.
 */

import { indexer } from "envio";

import { balanceTick, withStore } from "../lib/store.js";
import { logId } from "../lib/util.js";

/* ── Which accounts are merchants ───────────────────────────────────────── */

indexer.contractRegister({ contract: "MerchantRegistry", event: "MerchantRegistered" }, async ({ event, context }) => {
  context.chain.MerchantWallet.add(event.params.merchant);
});

indexer.contractRegister({ contract: "PolarisPayments", event: "PaymentMade" }, async ({ event, context }) => {
  context.chain.MerchantWallet.add(event.params.merchant);
});

indexer.contractRegister({ contract: "PolarisPayments", event: "OrderQuoted" }, async ({ event, context }) => {
  context.chain.MerchantWallet.add(event.params.merchant);
});

indexer.contractRegister({ contract: "PolarisPayments", event: "PlanCreated" }, async ({ event, context }) => {
  context.chain.MerchantWallet.add(event.params.merchant);
});

indexer.contractRegister({ contract: "PolarisLoanEngine", event: "LoanCreated" }, async ({ event, context }) => {
  context.chain.MerchantWallet.add(event.params.merchant);
});

/* ── Money in and out ───────────────────────────────────────────────────── */

indexer.onEvent(
  {
    contract: "MerchantWallet",
    event: "Transfer",
    wildcard: true,
    where: ({ chain }) => ({
      params: [{ from: chain.MerchantWallet.addresses }, { to: chain.MerchantWallet.addresses }],
    }),
  },
  async ({ event, context }) =>
    withStore(context, event, async (st) => {
      const { addresses } = st.settings;
      // Wildcard: any token's Transfer between these accounts arrives; only the stablecoin's counts.
      if (st.m.srcAddress !== addresses.Stablecoin) return;
      const { from, to, value } = event.params;
      if (from === to || value === 0n) return;

      const polaris = new Set<string>(
        Object.entries(addresses)
          .filter(([name]) => name !== "Stablecoin")
          .map(([, address]) => address),
      );

      let payee = await st.find("Merchant", to);
      const payer = await st.find("Merchant", from);
      // A payment's transfer comes before the event that introduces its
      // merchant (PaymentMade, LoanCreated), in the same transaction: money
      // from a Polaris contract to an unknown account is that merchant's.
      if (!payee && !payer && polaris.has(from)) payee = await st.merchant(to);

      if (payee) {
        const day = await st.merchantDay(payee);
        payee.balance += value;
        payee.updatedAt = st.m.timestamp;
        balanceTick(day, payee.balance);
      }

      if (payer) {
        const day = await st.merchantDay(payer);
        payer.balance -= value;
        payer.updatedAt = st.m.timestamp;
        balanceTick(day, payer.balance);

        const direct = st.m.to === addresses.Stablecoin;
        if (direct && !polaris.has(to)) {
          const id = logId(st.m.txHash, st.m.logIndex);
          st.keep("Payout", {
            id,
            merchant_id: payer.id,
            amount: value,
            destination: to,
            toPayoutAddress: payer.payoutAddress === to,
            relayer: st.m.from,
            day: st.m.day,
            timestamp: st.m.timestamp,
            blockNumber: st.m.blockNumber,
            txHash: st.m.txHash,
          });
          payer.payoutCount += 1;
          payer.payoutVolume += value;
          day.payoutCount += 1;
          day.payoutVolume += value;
          const p = await st.protocol();
          p.payoutCount += 1;
          p.payoutVolume += value;
          const pd = await st.protocolDay();
          pd.payoutCount += 1;
          pd.payoutVolume += value;
          st.activity("payout.paid", payer.id, { refId: id, amount: value, destination: to });
        }
      }
    }),
);
