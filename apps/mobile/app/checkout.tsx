import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { PublicKey } from "@solana/web3.js";
import { Button, Card, Money, Text } from "../src/ui/kit";
import { color, gutter, radius } from "../src/ui/theme";
import { shopOf } from "../src/lib/catalog";
import { explorerTx, MERCHANTS, PARAMS } from "../src/lib/config";
import { fmtUsd, ONE, planTotal } from "../src/lib/credit";
import { useAccount } from "../src/state/AccountProvider";
import { useAction } from "../src/state/useAction";
import { useWallet } from "../src/wallet/WalletProvider";
import { ix } from "../src/chain/polaris";
import { askCoach, coachMode, Facts, rulesSummary } from "../src/lib/coach";
import { buildFacts } from "../src/lib/facts";
import { scheduleDueReminder } from "../src/lib/notify";
import { AUTOPILOT } from "../src/dev/autopilot";

type Mode = "now" | "four";

export default function Checkout() {
  const params = useLocalSearchParams<{ shop?: string; item?: string; m?: string; amount?: string; title?: string; auto?: string }>();
  const router = useRouter();
  const a = useAccount();
  const { publicKey } = useWallet();
  const { run, busy } = useAction();

  // From the catalog, or from a payment link: polaris://checkout?m=<merchant>&amount=12.5&title=…
  const shop = params.shop ? shopOf(params.shop) : undefined;
  const item = shop?.items.find((i) => i.id === params.item);
  const merchantKey = shop ? MERCHANTS[shop.slug]?.authority : params.m;
  const merchantName =
    (shop && MERCHANTS[shop.slug]?.name) ?? Object.values(MERCHANTS).find((m) => m.authority === params.m)?.name ?? "Merchant";
  const price = Math.round((item?.price ?? Number(params.amount ?? 0)) * ONE);
  const title = item?.title ?? params.title ?? "Payment";

  const interval = a.config?.intervalSecs.toNumber() ?? PARAMS.intervalSecs;
  const total = planTotal(price, interval);
  const per = Math.floor(total / 4);
  const fits = price <= a.available && price >= ONE;
  const [mode, setMode] = useState<Mode>(fits && price >= 20 * ONE ? "four" : "now");
  const [done, setDone] = useState<{ sig: string; mode: Mode } | null>(null);
  const [coach, setCoach] = useState<{ text: string[]; ai: boolean } | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);

  const schedule = useMemo(() => {
    const start = Date.now() / 1000;
    return [0, 1, 2, 3].map((i) => ({
      at: start + interval * (i + 1),
      amount: i === 3 ? total - per * 3 : per,
    }));
  }, [interval, total, per]);

  const autoRan = useRef(false);
  useEffect(() => {
    if (AUTOPILOT && params.auto === "confirm" && !autoRan.current) {
      autoRan.current = true;
      confirm();
    }
  });

  if (!merchantKey || !price) {
    return (
      <SafeAreaView style={s.root}>
        <Text style={{ padding: 24 }}>This payment link is incomplete.</Text>
      </SafeAreaView>
    );
  }
  const merchant = new PublicKey(merchantKey);

  async function confirm() {
    const index = a.profile?.plansOpened ?? 0;
    const sig =
      mode === "now"
        ? await run("pay", async () => [ix.ensureUsdAta(publicKey!, merchant), await ix.pay(publicKey!, merchant, price)], `Paid ${merchantName} ${fmtUsd(price)}`)
        : await run(
            "plan",
            async () => [ix.ensureUsdAta(publicKey!, publicKey!), ix.ensureUsdAta(publicKey!, merchant), await ix.openPlan(publicKey!, merchant, price, index)],
            `Pay in 4 started: ${merchantName} paid in full`,
          );
    if (sig) {
      setDone({ sig, mode });
      if (mode === "four") scheduleDueReminder(merchantName, fmtUsd(per), schedule[0].at).catch(() => {});
    }
  }

  async function ask() {
    setCoachBusy(true);
    const facts: Facts = {
      ...buildFacts(a),
      question: { merchant: merchantName, item: title, price, perInstallment: per },
    };
    try {
      if ((await coachMode()) === "off") setCoach({ text: rulesSummary(facts), ai: false });
      else setCoach({ text: [await askCoach("Can I afford this on Pay in 4, and what does it do to my limit?", facts)], ai: true });
    } catch (e: any) {
      setCoach({ text: [...rulesSummary(facts), `(AI unavailable: ${e?.message ?? e})`], ai: false });
    } finally {
      setCoachBusy(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView style={s.root}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={s.check}>
            <Ionicons name="checkmark" size={40} color={color.onLime} />
          </View>
          <Text weight="bold" size={34} style={{ marginTop: 18 }}>
            Done.
          </Text>
          <Text size={15} color={color.muted} style={{ textAlign: "center", marginTop: 8, lineHeight: 21 }}>
            {done.mode === "now"
              ? `${merchantName} is paid ${fmtUsd(price)}.`
              : `${merchantName} is paid in full. Your first payment of ${fmtUsd(per)} is due ${new Date(schedule[0].at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Pay early: it counts as on time.`}
          </Text>
          <Card style={{ alignSelf: "stretch", marginTop: 24 }}>
            <KV k="For" v={title} />
            <KV k={done.mode === "now" ? "Paid" : "Plan"} v={done.mode === "now" ? fmtUsd(price) : `4 × ${fmtUsd(per)}`} />
            <KV k="Transaction" v={`${done.sig.slice(0, 10)}…`} />
          </Card>
        </View>
        <View style={{ flexDirection: "row", gap: 10, padding: gutter }}>
          <Button title="View receipt" kind="ink" style={{ flex: 1 }} onPress={() => Linking.openURL(explorerTx(done.sig))} />
          <Button testID="checkout-done" title="Done" style={{ flex: 1 }} onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.grabber} />
      <View style={s.top}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-down" size={24} color={color.text} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text weight="bold" size={17}>
            {merchantName}
          </Text>
          <Text size={12} color={color.muted}>
            {shop?.tagline ?? "Payment link"}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: 24 }}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={[s.logo, { backgroundColor: shop?.tint ?? color.purple }]}>
            <Ionicons name={(shop?.icon as any) ?? "storefront"} size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text size={12} color={color.muted}>
              {title}
            </Text>
            <Money value={price / ONE} size={34} />
          </View>
        </Card>

        <View style={s.seg}>
          {(["now", "four"] as Mode[]).map((m) => (
            <Pressable
              key={m}
              testID={`mode-${m}`}
              onPress={() => setMode(m)}
              style={[s.segBtn, mode === m && { backgroundColor: m === "four" ? color.purple : color.text }]}
            >
              <Text weight="bold" size={14} color={mode === m ? (m === "four" ? "#fff" : color.onLime) : color.muted}>
                {m === "now" ? "Pay now" : "Pay in 4"}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === "four" ? (
          <>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Mini label="Pay in 4" value={`${fmtUsd(per)} × 4`} />
              <Mini label="Interest (10% APR)" value={fmtUsd(total - price)} />
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Mini label="Due today" value="$0.00" tone={color.lime} />
              <Mini label="Available to spend" value={fmtUsd(a.available)} tone={fits ? color.text : color.down} />
            </View>
            <Card style={{ marginTop: 10 }}>
              {schedule.map((x, i) => (
                <KV
                  key={i}
                  k={["First", "Second", "Third", "Fourth"][i] + " payment"}
                  v={`${fmtUsd(x.amount)} · ${new Date(x.at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                />
              ))}
            </Card>
            {!fits ? (
              <Pressable onPress={() => router.push("/skr")}>
                <Card style={[s.warn]}>
                  <Ionicons name="lock-closed" size={16} color={color.warn} />
                  <Text size={13} style={{ flex: 1 }}>
                    Over your available {fmtUsd(a.available)}. Lock SKR to raise your limit, or pay now.
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={color.muted} />
                </Card>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Card style={{ marginTop: 12 }}>
            <KV k="Merchant" v={merchantName} />
            <KV k="From" v={`Dollar account · ${fmtUsd(a.usd)}`} />
            <KV k="Network fee" v="< $0.01 in SOL" />
          </Card>
        )}

        <Pressable onPress={ask} disabled={coachBusy} testID="ask-coach">
          <Card style={s.coach}>
            <Ionicons name="sparkles" size={16} color={color.purpleText} />
            <Text size={13} weight="medium" color={color.purpleText} style={{ flex: 1 }}>
              {coachBusy ? "Thinking…" : "Ask Coach: can I afford this?"}
            </Text>
          </Card>
        </Pressable>
        {coach ? (
          <Card style={{ marginTop: 8, gap: 6 }}>
            {coach.text.map((t, i) => (
              <Text key={i} size={13} style={{ lineHeight: 19 }}>
                {t}
              </Text>
            ))}
            <Text size={11} color={color.dim}>
              {coach.ai ? "Claude, from your on-chain profile" : "Rules-based summary (AI off)"}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
      <View style={{ padding: gutter, paddingTop: 0 }}>
        {mode === "now" ? (
          <Button
            testID="confirm"
            title={`Pay ${fmtUsd(price)}`}
            disabled={a.usd < price}
            loading={busy === "pay"}
            onPress={confirm}
          />
        ) : (
          <Button
            testID="confirm"
            title="Start Pay in 4"
            kind="purple"
            disabled={!fits}
            loading={busy === "plan"}
            onPress={confirm}
          />
        )}
        {a.usd < price && mode === "now" ? (
          <Text size={12} color={color.muted} style={{ textAlign: "center", marginTop: 8 }}>
            Not enough pUSD. Tap Add on Home for test dollars, or use Pay in 4.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
      <Text size={13} color={color.muted}>
        {k}
      </Text>
      <Text size={13} weight="medium">
        {v}
      </Text>
    </View>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.mini}>
      <Text size={11} color={color.muted}>
        {label}
      </Text>
      <Text weight="bold" size={17} color={tone ?? color.text} style={{ marginTop: 4 }}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: color.surface3, marginTop: 8 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: gutter, paddingVertical: 10 },
  logo: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  seg: { flexDirection: "row", backgroundColor: color.surface1, borderRadius: radius.pill, padding: 4, marginTop: 12 },
  segBtn: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  mini: { flex: 1, backgroundColor: color.surface1, borderRadius: radius.surface, padding: 14 },
  warn: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, borderWidth: 1, borderColor: color.warn + "44" },
  coach: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, borderWidth: 1, borderColor: color.purple + "44" },
  check: { width: 76, height: 76, borderRadius: 38, backgroundColor: color.lime, alignItems: "center", justifyContent: "center" },
});
