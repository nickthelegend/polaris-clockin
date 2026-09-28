# Privy, live on Monad testnet

<!-- FILLED IN BY THE LIVE RUN -->

## Gas sponsorship: what Privy offers, and why Polaris doesn't need it

Read on docs.privy.io on 28 Sep 2026
([overview](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview),
[setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup),
[Ethereum](https://docs.privy.io/wallets/gas-and-asset-management/gas/ethereum)):

- Privy's **native gas sponsorship** lists **Monad Testnet** (and Monad) among
  its EVM networks. It upgrades the wallet with **EIP-7702** and pays through
  Privy's paymaster; a transaction is sponsored by passing `sponsor: true` to
  `sendTransaction` (React `useSendTransaction`, or the Node SDK's
  `wallets().ethereum().sendTransaction`). It only covers transactions the
  wallet itself sends (`eth_sendTransaction`).
- **It can't be turned on through the API.** It needs the dashboard, TEE
  execution for the app, and credits.

**Polaris doesn't use it, and doesn't need it.** No Polaris user or merchant
wallet ever sends a transaction:

- a buyer, a sender, a link's recipient and a borrower only sign EIP-712 /
  ERC-2612 / ERC-3009 messages;
- a merchant's Privy embedded wallet only signs typed data too: its
  `MerchantRegistry` Registration, its withdrawals
  (`TransferWithAuthorization`) and a payout address change;
- the relayer, a Privy server wallet held to its policy, sends every one of
  those as a transaction and pays the gas from its own MON (route B:
  `eth_signTransaction` in Privy's enclave, broadcast by us, with the gas limit
  set from `estimateGas` + 15%, because Monad bills the limit).

So "gasless" does not depend on a dashboard switch, and every action is
gasless on Monad testnet today. The plan also rules EIP-7702 out on purpose
(plan §5.3, research §8): Monad keeps a reserve balance on 7702-delegated
accounts, and Mera accounts are plain EOAs.

If you want Privy to pay the relayer's own gas as well (the one wallet that
holds MON), these are the dashboard steps, which only you can take:

1. Privy dashboard → **Fee sponsorship** → **Add credits** (prepaid), or turn
   on postpaid billing.
2. Turn on **Sponsor gas fees**.
3. Under **Supported chains**, select **Monad Testnet**.
4. Make sure the app uses **TEE execution** (a requirement of native
   sponsorship).

The relayer would then have to move from `eth_signTransaction` to Privy's
`eth_sendTransaction` with `sponsor: true` (route A), giving up setting its own
gas limit, and the relayer wallet would be 7702-upgraded. Not done here.
