import { PublicKey } from "@solana/web3.js";
import deployments from "../chain/deployments.json";

// Which deployment the build talks to. Release builds use devnet; a dev build
// can point at the local validator (packages/solana, port 4270) with
// EXPO_PUBLIC_CLUSTER=localnet. Never mainnet.
export type Cluster = "devnet" | "localnet";
const requested = (process.env.EXPO_PUBLIC_CLUSTER as Cluster | undefined) ?? "devnet";
const available = deployments as Record<string, any>;
export const CLUSTER: Cluster = available[requested] ? requested : (Object.keys(available)[0] as Cluster);
const d = available[CLUSTER];

// A localnet build must say where the validator is (EXPO_PUBLIC_LOCAL_HOST:
// 127.0.0.1 on the iOS simulator, 10.0.2.2 on an Android emulator), so no
// local address is ever baked into a devnet release bundle.
export const RPC_URL =
  process.env.EXPO_PUBLIC_RPC_URL ??
  (CLUSTER === "localnet" ? `http://${process.env.EXPO_PUBLIC_LOCAL_HOST}:4270` : "https://api.devnet.solana.com");
export const MWA_CHAIN = CLUSTER === "devnet" ? "solana:devnet" : "solana:localnet";

export const PROGRAM_ID = new PublicKey(d.programId);
export const USD_MINT = new PublicKey(d.usdMint);
export const SKR_MINT = new PublicKey(d.skrMint);
export const MERCHANTS: Record<string, { name: string; authority: string; pda: string }> = d.merchants ?? {};
export const PARAMS = d.params as {
  intervalSecs: number;
  graceSecs: number;
  skrPriceMicros: number;
  skrCollateralBps: number;
  checkinReward: number;
};

export const USD_LABEL = "pUSD";
export const SKR_LABEL = "SKR";
export const SKR_STANDIN_NOTE = "SKR (devnet stand-in)";
export const SKR_MAINNET_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";

export const APP_IDENTITY = {
  name: "Polaris",
  uri: "https://github.com/nickthelegend/polaris-clockin",
  icon: "favicon.ico",
};

export const explorerTx = (sig: string) =>
  CLUSTER === "devnet"
    ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    : `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
