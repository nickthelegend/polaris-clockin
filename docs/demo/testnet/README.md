# Gasless on Monad testnet: the live run

Written by `pnpm --filter @polaris/business smoke:testnet -- --run` on 2026-09-28T11:12:01.426Z. Every row is a real Monad testnet (chain 10143) transaction, read back from the chain: status 1, sent to the contract named, and sent by the account in "Sent by". The dollar is `MockAUSD`, a labelled mock (decision 24).

**Relayer:** the Privy server wallet `0x8366916019bc5452e62A0D36418ABebB45396aE2` (Privy wallet `y8sa671n804anaxznbeneh2q`, policy `qqsjm4wxjn9pefv8v4njbmit`). It sent 15 transactions and spent 0.372994824 MON.
**Registry admin:** the Privy server wallet `0xa089EeEA5B1625C586380596bde502aB46F3e45F`, which owns MerchantRegistry and may only activate and cap merchants. It spent 0.01117818 MON.

| # | Step | Signed by | Sent by | Contract | Transaction | Block |
|---|---|---|---|---|---|---:|
| 1 | The merchant registers on MerchantRegistry: its Registration signature, registerFor sent by the relayer | merchant | Privy relayer | MerchantRegistry | [`0x576f4ead…833c74`](https://testnet.monadscan.com/tx/0x576f4ead74715bfc8038e9d9d6ea87e4f1dd8f5f934d5efa2380fa7e8e833c74) | 66392905 |
| 2 | Harness: mint $1000 of MockAUSD (the labelled mock dollar) to the buyer | harness | harness (deployer) | Stablecoin | [`0x89b8a0de…017567`](https://testnet.monadscan.com/tx/0x89b8a0de0522a64a1ae5fde80297c63f22c1588bd4983b82f9c10953f4017567) | 66392909 |
| 3 | Pay now $25: PolarisCheckout.pay | buyer (ReceiveWithAuthorization) | Privy relayer | PolarisCheckout | [`0xedc91c93…c22e6e`](https://testnet.monadscan.com/tx/0xedc91c93521bec8bb5ade52c2de7f0bdb654f2176aeb685b6ac73d2b28c22e6e) | 66393023 |
| 4 | The registry admin caps the merchant: MerchantRegistry.setMaxOrderValue | none (the registry admin's own call, under its Privy policy) | Privy registry admin | MerchantRegistry | [`0x4f33f626…83f640`](https://testnet.monadscan.com/tx/0x4f33f626eaf83f9f37c5361f98c6a29e62db22ce24dcbfc4c93299f80f83f640) | 66393029 |
| 5 | The registry admin activates the merchant for Pay in 4: MerchantRegistry.setActive | none (the registry admin's own call, under its Privy policy) | Privy registry admin | MerchantRegistry | [`0x0b9e45ff…bb1cb1`](https://testnet.monadscan.com/tx/0x0b9e45ffe03c3bea14d1b4866473f7dfb9f62dbd1cfac95628de3e5884bb1cb1) | 66393034 |
| 6 | A secured line: the buyer sets $202 aside, CollateralVault.lockWithPermit | buyer (Permit to the vault) | Privy relayer | CollateralVault | [`0x2efc674a…04d5fc`](https://testnet.monadscan.com/tx/0x2efc674a32e4c3403288aa83f99ea5913a80ab10a796dfbe4a510d6f2d04d5fc) | 66393041 |
| 7 | Pay in 4 $200 (4 instalments, 60 s apart): PolarisCheckout.openPlan | buyer (PlanIntent + Permit) | Privy relayer | PolarisCheckout | [`0x70cd0468…abdf06`](https://testnet.monadscan.com/tx/0x70cd0468cb0eeeb95fe5c9854e50dd6810f87c8412399b72955858a68dabdf06) | 66393057 |
| 8 | The merchant's subscription plan: PolarisPayments.createPlanFor (operator) | none (operator: the session's terms) | Privy relayer | PolarisPayments | [`0x5c304b0f…2d739c`](https://testnet.monadscan.com/tx/0x5c304b0fb31f96f825f0cce31e4bd62ad10f625cd4db6d27c9ad1cbcca2d739c) | 66393070 |
| 9 | Subscribe $5 a month, first month charged: PolarisCheckout.subscribe | buyer (SubscribeIntent + Permit) | Privy relayer | PolarisCheckout | [`0xda41c41f…3f9224`](https://testnet.monadscan.com/tx/0xda41c41fc87de25b27c9c9413ecd612f4ad7645ddc3790b9a77bb2634a3f9224) | 66393078 |
| 10 | Pay an instalment early, $50.000038: PolarisLoanEngine.repayWithSig | buyer (RepayIntent) | Privy relayer | PolarisLoanEngine | [`0x557e6f99…f9504d`](https://testnet.monadscan.com/tx/0x557e6f997e8aa028e85860cb7073d6fa84c98fc2477ad7ee799c251654f9504d) | 66393087 |
| 11 | Harness: a lost approval (the buyer's signed permit(0) to the loan engine, submitted by the deployer) | buyer (Permit, value 0) | harness (deployer) | Stablecoin | [`0xcaafc22b…02a2e4`](https://testnet.monadscan.com/tx/0xcaafc22b0d43cd5af633c2357d7f02c2bc3809eaa4f385606726ff9c8602a2e4) | 66393092 |
| 12 | The buyer signs again: PolarisCheckout.reauthorize (Reauthorized: the CRE collections log trigger) | buyer (Permit to the loan engine) | Privy relayer | PolarisCheckout | [`0xc34da0c3…b7fd19`](https://testnet.monadscan.com/tx/0xc34da0c3d6f2744e04f1ffb46e3cc73694947be4c20ccf9bd86604cc17b7fd19) | 66393099 |
| 13 | Send $10 by link: PolarisSend.send | sender (ReceiveWithAuthorization) + link key (Open) | Privy relayer | PolarisSend | [`0xc262b283…9f5913`](https://testnet.monadscan.com/tx/0xc262b2838ea22630eff5873d0907ec88eb4240a333f07be77122262d619f5913) | 66393107 |
| 14 | The link is claimed on a new phone: PolarisSend.claim | link key (Claim naming the recipient) | Privy relayer | PolarisSend | [`0x30ee0025…c8119a`](https://testnet.monadscan.com/tx/0x30ee00250e065a8081da4360c5c18ed9a123d2bc57d65413d8ae8e6030c8119a) | 66393114 |
| 15 | Cancel the subscription: PolarisPayments.cancelWithSignature | subscriber (CancelSubscription) | Privy relayer | PolarisPayments | [`0x9c35028b…cbfbe6`](https://testnet.monadscan.com/tx/0x9c35028b916d2fa02f53b343373530771c083bf4af75afbfa78b5a6b66cbfbe6) | 66393121 |
| 16 | The merchant withdraws $100 in one tap: AUSD transferWithAuthorization | merchant (TransferWithAuthorization) | Privy relayer | Stablecoin | [`0x5ab0ecc0…0b7f48`](https://testnet.monadscan.com/tx/0x5ab0ecc02861ca4354f74d7d9dfac42792d72207de3c15158136cf8d540b7f48) | 66393130 |
| 17 | The session's price pinned on its order: PolarisPayments.quoteOrder (operator) | none (operator: the session's price) | Privy relayer | PolarisPayments | [`0xfb2e5c92…0936ae`](https://testnet.monadscan.com/tx/0xfb2e5c92f10bb18736d297cb0d559a33ab888c496cc6d1ecf1a26bebb90936ae) | 66392922 |
| 18 | The session's price pinned on its order: PolarisPayments.quoteOrder (operator) | none (operator: the session's price) | Privy relayer | PolarisPayments | [`0xb321eda5…ec3e6e`](https://testnet.monadscan.com/tx/0xb321eda5a1bd9639b6ceca0d423f6bd5ae3cb6173704acb0efdc5eeb36ec3e6e) | 66393048 |
| 19 | The session's price pinned on its order: PolarisPayments.quoteOrder (operator) | none (operator: the session's price) | Privy relayer | PolarisPayments | [`0x1d17fb34…fd5a9a`](https://testnet.monadscan.com/tx/0x1d17fb34344ffc183f3d8e345edb51e15749215656a0af714da7dd3797fd5a9a) | 66393064 |

## The users paid nothing

Every account below was generated for this run. None was ever sent MON, and none sent a transaction: its MON balance and its nonce are read from the chain before the first step and after the last.

| Account | Role | MON before | MON after | Nonce before | Nonce after |
|---|---|---:|---:|---:|---:|
| `0x41b556dEE537D2cfB2b12Fb2C45833Cbbb20a038` | merchant (registers, is paid, withdraws) | 0 | 0 | 0 | 0 |
| `0xd516876FB1e2E84A60fe7867B84c0C75168D9bC2` | the merchant's payout address | 0 | 0 | 0 | 0 |
| `0xA38c9E92fC91CEAFc6c50eCD2D16F62A61C3a652` | buyer (Pay now, collateral, Pay in 4, subscribe, pay early, re-sign, send, cancel) | 0 | 0 | 0 | 0 |
| `0x39B8F8C0a2417b7784D36EC114baD129E0679919` | send-by-link key (opens and claims the link) | 0 | 0 | 0 | 0 |
| `0x785764220c1CDa0De85C228566BaD22E00AdBA12` | the link's recipient | 0 | 0 | 0 | 0 |

## Webhooks

- `payment.succeeded` (evt_1309530e5f0800b1ff9e516c0b5f), verified with polarispay-sdk
- `plan.opened` (evt_d91606267068d6b21429735a0095), verified with polarispay-sdk
- `subscription.charged` (evt_59ca41551c8719d94cd80c48c3f3), verified with polarispay-sdk
- `installment.collected` (evt_266b61192513a3bf28d903d53ae5), verified with polarispay-sdk
- `subscription.canceled` (evt_1b58c6cf9afdea15b2f3b65524d4), verified with polarispay-sdk

Every hash, id and address: [`results.json`](results.json).
