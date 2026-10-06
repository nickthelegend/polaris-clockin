// Autopilot: a scripted walk through the app for screenshots and an
// end-to-end check on a simulator where nothing can tap. Off unless the
// bundle is built with EXPO_PUBLIC_AUTOPILOT=1 (never in the release APK).
// Each step sends real transactions through the same code the buttons use,
// then writes "SHOT <n> <name>" to Documents/autopilot.txt; the host script
// (scripts/ios-shots.sh) takes a simulator screenshot when it sees it.
import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useWallet } from "../wallet/WalletProvider";
import { useAccount } from "../state/AccountProvider";
import { ix } from "../chain/polaris";
import { SKR_MINT, USD_MINT } from "../lib/config";
import { ONE } from "../lib/credit";

export const AUTOPILOT = process.env.EXPO_PUBLIC_AUTOPILOT === "1";
export const bus: { lastLink?: string } = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log: string[] = [];
function mark(line: string) {
  log.push(`${new Date().toISOString()} ${line}`);
  console.log(`[autopilot] ${line}`);
  try {
    new File(Paths.document, "autopilot.txt").write(log.join("\n") + "\n");
  } catch (e) {
    console.warn("autopilot write", e);
  }
}

export function Autopilot() {
  const router = useRouter();
  const w = useWallet();
  const a = useAccount();
  const ref = useRef({ w, a });
  ref.current = { w, a };
  const started = useRef(false);

  useEffect(() => {
    if (!AUTOPILOT || started.current || !w.ready) return;
    started.current = true;
    (async () => {
      let n = 0;
      const shot = async (name: string, settle = 2500) => {
        await sleep(settle);
        mark(`SHOT ${String(++n).padStart(2, "0")} ${name}`);
        await sleep(2000);
      };
      const step = async (name: string, fn: () => Promise<unknown>) => {
        try {
          const r = await fn();
          mark(`OK ${name}${typeof r === "string" ? ` ${r}` : ""}`);
        } catch (e: any) {
          mark(`FAIL ${name} ${e?.message ?? e}`);
          throw e;
        }
      };
      const send = (ixs: any[]) => ref.current.w.send(ixs);
      const refresh = async () => {
        await ref.current.a.refresh();
        await sleep(1500);
      };
      try {
        if (ref.current.w.publicKey) await ref.current.w.disconnect();
        await SecureStore.deleteItemAsync("polaris.guest.secret.v1"); // a fresh buyer every run
        router.replace("/onboarding");
        await shot("onboarding", 3000);
        await step("guest", () => ref.current.w.useGuest());
        router.replace("/(tabs)");
        await sleep(1500);
        await step("airdrop", () => ref.current.w.requestAirdrop());
        await refresh();
        await shot("home-new");
        await step("faucet", async () => {
          const me = ref.current.w.publicKey!;
          return send([await ix.initProfile(me), await ix.faucet(me, USD_MINT, 250 * ONE), await ix.faucet(me, SKR_MINT, 1_000 * ONE)]);
        });
        await refresh();
        await step("checkin", async () => send([await ix.checkIn(ref.current.w.publicKey!)]));
        await refresh();
        await shot("home-clocked-in");
        router.push("/(tabs)/shop");
        await shot("shop");
        router.push({ pathname: "/checkout", params: { shop: "kora-rail", item: "porto" } });
        await shot("checkout-over-limit");
        router.back();
        await step("faucet-skr", async () => {
          const me = ref.current.w.publicKey!;
          return send([await ix.faucet(me, SKR_MINT, 1_000 * ONE), await ix.faucet(me, SKR_MINT, 1_000 * ONE), await ix.faucet(me, SKR_MINT, 1_000 * ONE)]);
        });
        await step("lock-skr", async () => send([await ix.lockSkr(ref.current.w.publicKey!, 3_000 * ONE)]));
        await refresh();
        router.push("/skr");
        await shot("skr-locked");
        router.back();
        await sleep(800);
        router.push({ pathname: "/checkout", params: { shop: "kora-rail", item: "porto" } });
        await shot("checkout-pay-in-4");
        router.setParams({ auto: "confirm" });
        await sleep(9000);
        await shot("checkout-done", 1000);
        router.back();
        await refresh();
        router.push("/(tabs)/credit");
        await shot("credit");
        router.push({ pathname: "/plan", params: { index: "0" } });
        await shot("plan");
        router.setParams({ auto: "repay" });
        await sleep(9000);
        await refresh();
        await shot("plan-after-repay", 1000);
        router.back();
        await shot("credit-after-repay");
        router.push({ pathname: "/send", params: { amount: "25", auto: "1" } });
        await sleep(9000);
        await shot("send-link", 1000);
        const link = bus.lastLink;
        mark(`OK link ${link ? "created" : "missing"}`);
        router.back();
        await sleep(800);
        if (link) {
          const k = link.split("k=")[1];
          router.push({ pathname: "/claim", params: { k } });
          await shot("claim");
          router.setParams({ auto: "1" });
          await sleep(9000);
          await shot("claim-done", 1000);
          router.replace("/(tabs)");
        }
        await refresh();
        await shot("home-after");
        router.push("/(tabs)/coach");
        await sleep(1500);
        router.setParams({ q: "How do I reach the next tier fastest?" });
        await shot("coach", 4000);
        router.push("/(tabs)/me");
        await shot("me");
        mark("DONE");
      } catch (e: any) {
        mark(`ABORT ${e?.message ?? e}`);
      }
    })();
  }, [w.ready]);
  return null;
}
