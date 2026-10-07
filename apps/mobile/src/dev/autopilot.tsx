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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useWallet } from "../wallet/WalletProvider";
import { useAccount } from "../state/AccountProvider";
import { connection, fetchConfig, fetchPlans, fetchProfile, ix, skrAta, tokenBalance, usdAta } from "../chain/polaris";
import { SKR_MINT, USD_MINT } from "../lib/config";
import { ONE } from "../lib/credit";

import { AUTOPILOT, bus } from "./bus";
export { AUTOPILOT, bus };

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
        const a = ref.current.a;
        if (a.error) {
          const me = ref.current.w.publicKey!;
          const probes: [string, () => Promise<unknown>][] = [
            ["getBalance", () => connection.getBalance(me)],
            ["tokenBalance", () => tokenBalance(usdAta(me))],
            ["fetchProfile", () => fetchProfile(me)],
            ["fetchConfig", () => fetchConfig()],
            ["fetchPlans", () => fetchPlans(me)],
            ["skrAta", async () => skrAta(me).toBase58()],
          ];
          for (const [name, f] of probes) {
            try {
              await f();
              mark(`PROBE ${name} ok`);
            } catch (e: any) {
              mark(`PROBE ${name} ${e?.message} | ${String(e?.stack ?? "").split("\n").slice(0, 6).join(" <- ")}`);
            }
          }
        }
        mark(`STATE usd=${a.usd} skr=${a.skr} sol=${a.sol} score=${a.score} plans=${a.plans.length} error=${a.error ?? "none"}`);
      };
      // Ask the host script (scripts/ios-shots.sh) to do something outside the
      // app, e.g. change the simulator's text size, and wait for its ack.
      let cmdN = 0;
      const host = async (cmd: string) => {
        const id = ++cmdN;
        mark(`CMD ${id} ${cmd}`);
        const ack = new File(Paths.document, `ack-${id}.txt`);
        for (let i = 0; i < 60 && !ack.exists; i++) await sleep(500);
        await sleep(1500);
      };
      try {
        if (ref.current.w.publicKey) await ref.current.w.disconnect();
        await SecureStore.deleteItemAsync("polaris.guest.secret.v1"); // a fresh buyer every run
        await AsyncStorage.removeItem("polaris.hint.payin4.v1");
        router.replace("/onboarding");
        await shot("onboarding-1", 3000);
        router.setParams({ page: "1" });
        await shot("onboarding-2");
        router.setParams({ page: "2" });
        await shot("onboarding-3-connect");
        await step("guest", () => ref.current.w.useGuest());
        router.replace("/(tabs)");
        await sleep(2500);
        await refresh();
        await shot("home-new-no-sol");
        await step("airdrop", () => ref.current.w.requestAirdrop());
        await step("faucet", async () => {
          const me = ref.current.w.publicKey!;
          return send([await ix.initProfile(me), await ix.faucet(me, USD_MINT, 250 * ONE), await ix.faucet(me, SKR_MINT, 1_000 * ONE)]);
        });
        await refresh();
        await shot("home-funded");
        await step("checkin", async () => send([await ix.checkIn(ref.current.w.publicKey!)]));
        await refresh();
        await shot("home-clocked-in");
        router.push("/(tabs)/shop");
        await shot("shop");
        router.push({ pathname: "/checkout", params: { shop: "kora-rail", item: "porto" } });
        await shot("checkout-payin4-first-run-over-limit");
        router.setParams({ mode: "now" });
        await shot("checkout-pay-now");
        router.back();
        await sleep(800);
        router.push("/skr");
        await shot("skr-before-lock");
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
        await shot("checkout-payin4-fits");
        router.setParams({ auto: "confirm" });
        await sleep(9000);
        await shot("checkout-done-receipt", 1000);
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
        router.push("/send");
        await shot("send-keypad-empty");
        router.back();
        await sleep(800);
        router.push({ pathname: "/send", params: { amount: "25", auto: "1" } });
        await sleep(9000);
        await shot("send-link-ready", 1000);
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
          await shot("claim-done-receipt", 1000);
          router.replace("/(tabs)");
        }
        await refresh();
        await shot("home-after");
        router.push("/(tabs)/coach");
        await shot("coach-ai-off");
        router.setParams({ q: "How do I reach the next tier fastest?" });
        await shot("coach-answer", 4000);
        router.setParams({ q: "Why is my limit what it is?" });
        await shot("coach-answer-limit", 4000);
        router.push("/(tabs)/me");
        await shot("me");
        router.setParams({ advanced: "1" });
        await shot("me-advanced");
        router.push("/(tabs)");
        bus.simulateOffline = true;
        await refresh();
        await shot("home-offline-simulated");
        bus.simulateOffline = false;
        await refresh();
        await host("textsize accessibility-extra-large");
        await shot("home-large-text", 3000);
        router.push("/(tabs)/credit");
        await shot("credit-large-text");
        router.push({ pathname: "/checkout", params: { shop: "kora-rail", item: "porto" } });
        await shot("checkout-large-text");
        router.back();
        await host("textsize large");
        mark("DONE");
      } catch (e: any) {
        mark(`ABORT ${e?.message ?? e}`);
      }
    })();
  }, [w.ready]);
  return null;
}
