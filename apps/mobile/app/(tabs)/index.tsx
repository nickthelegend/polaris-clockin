import React, { useEffect, useState } from "react";
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Button, Card, Money, Row, SectionTitle, Tag, Text } from "../../src/ui/kit";
import { StreakRing } from "../../src/ui/Art";
import { color, gutter, radius } from "../../src/ui/theme";
import { useAccount } from "../../src/state/AccountProvider";
import { useAction } from "../../src/state/useAction";
import { useWallet, explainError } from "../../src/wallet/WalletProvider";
import { ix, merchantName } from "../../src/chain/polaris";
import { CLUSTER, PARAMS, SKR_MINT, USD_MINT, explorerTx } from "../../src/lib/config";
import { checkinReward, dueAt, fmtDue, fmtSkr, fmtUsd, installmentAmount, ONE, today } from "../../src/lib/credit";
import { scheduleClockInReminder } from "../../src/lib/notify";
import { useToast } from "../../src/ui/Toast";

function untilTomorrowUtc() {
  const now = Date.now();
  const next = (today() + 1) * 86_400_000;
  const h = Math.floor((next - now) / 3_600_000);
  const m = Math.floor(((next - now) % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function Home() {
  const router = useRouter();
  const a = useAccount();
  const { publicKey, kind, requestAirdrop } = useWallet();
  const { run, busy } = useAction();
  const toast = useToast();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const p = a.profile;
  const streak = p?.streak ?? 0;
  const alive = !!p && p.lastCheckInDay.toNumber() >= today() - 1;
  const shownStreak = alive ? streak : 0;
  const nextStreak = a.checkedInToday ? streak + 1 : alive ? streak + 1 : 1;
  const rewardBase = a.config?.checkinReward.toNumber() ?? PARAMS.checkinReward;
  const nextReward = checkinReward(rewardBase, nextStreak) / ONE;
  const lowSol = a.sol < 0.003 * LAMPORTS_PER_SOL;

  const open = a.plans.filter((pl) => pl.paid < pl.installments);
  const due = open
    .map((pl) => ({
      pl,
      at: dueAt(pl.startedAt.toNumber(), pl.intervalSecs.toNumber(), pl.paid),
      amount: installmentAmount(pl.totalOwed.toNumber(), pl.repaid.toNumber(), pl.paid),
    }))
    .sort((x, y) => x.at - y.at);

  async function clockIn() {
    const sig = await run("checkin", async () => [await ix.checkIn(publicKey!)], `Clocked in: +${nextReward} SKR, +1 score`);
    if (sig) scheduleClockInReminder(nextStreak + 1, checkinReward(rewardBase, nextStreak + 1) / ONE).catch(() => {});
  }

  async function addMoney() {
    await run(
      "faucet",
      async () => [await ix.faucet(publicKey!, USD_MINT, 250 * ONE), await ix.faucet(publicKey!, SKR_MINT, 500 * ONE)],
      "Added $250 test dollars and 500 SKR (devnet)",
    );
  }

  async function getSol() {
    try {
      await requestAirdrop();
      toast({ kind: "ok", text: "Devnet SOL added for fees" });
      a.refresh();
    } catch (e) {
      toast({ kind: "error", text: explainError(e) });
      if (CLUSTER === "devnet") Linking.openURL("https://faucet.solana.com");
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: gutter, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={a.loading} onRefresh={a.refresh} tintColor={color.muted} />}
      >
        <View style={s.header}>
          <Image source={require("../../assets/wordmark.png")} style={{ width: 92, height: 28 }} resizeMode="contain" />
          <Pressable onPress={() => router.push("/(tabs)/me")} style={s.chip}>
            <View style={[s.dot, { backgroundColor: kind === "guest" ? color.warn : color.lime }]} />
            <Text size={12} weight="medium" color={color.muted}>
              {publicKey?.toBase58().slice(0, 4)}…{publicKey?.toBase58().slice(-4)} · {CLUSTER}
            </Text>
          </Pressable>
        </View>

        {/* Dollar account */}
        <View style={s.lime}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={s.inkPill}>
              <Text size={12} weight="medium">
                Dollar account
              </Text>
            </View>
            <Text size={12} weight="medium" color="rgba(15,16,17,0.6)">
              pUSD · test dollars
            </Text>
          </View>
          <View style={{ marginTop: 18 }}>
            <Money value={a.usd / ONE} size={46} color={color.onLime} />
          </View>
          <View style={s.actions}>
            {[
              { icon: "add", label: "Add", on: addMoney, id: "faucet" },
              { icon: "arrow-up", label: "Send", on: () => router.push("/send") },
              { icon: "bag-handle", label: "Shop", on: () => router.push("/(tabs)/shop") },
              { icon: "pulse", label: "Credit", on: () => router.push("/(tabs)/credit") },
            ].map((b) => (
              <Pressable key={b.label} testID={`home-${b.label}`} onPress={b.on} style={s.action} disabled={!!busy}>
                <View style={s.actionIcon}>
                  <Ionicons name={b.icon as any} size={20} color={color.text} />
                </View>
                <Text size={12} weight="medium" color={color.onLime}>
                  {busy === b.id ? "…" : b.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {a.error ? (
          <Card style={[s.notice, { marginTop: 12, borderColor: color.down + "55" }]}>
            <Ionicons name="cloud-offline" size={18} color={color.down} />
            <Text size={13} style={{ flex: 1 }}>
              Can't read the Polaris program on {CLUSTER} right now. Pull to retry.
            </Text>
          </Card>
        ) : null}

        {lowSol ? (
          <Card style={[s.notice, { marginTop: 12 }]}>
            <Ionicons name="flash" size={18} color={color.warn} />
            <Text size={13} color={color.text} style={{ flex: 1 }}>
              Network fees on {CLUSTER} are paid in SOL. You have {(a.sol / LAMPORTS_PER_SOL).toFixed(4)}.
            </Text>
            <Pressable onPress={getSol} hitSlop={8}>
              <Text size={13} weight="bold" color={color.lime}>
                Get SOL
              </Text>
            </Pressable>
          </Card>
        ) : null}

        {/* The daily loop */}
        <Card style={{ marginTop: 12, padding: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View>
              <StreakRing days={shownStreak} />
              <View style={s.ringLabel}>
                <Text weight="bold" size={20}>
                  {shownStreak}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="bold" size={17}>
                {a.checkedInToday ? "Clocked in today" : shownStreak > 0 ? `Day ${shownStreak + 1} is waiting` : "Clock in"}
              </Text>
              <Text size={13} color={color.muted} style={{ marginTop: 3 }}>
                {a.checkedInToday
                  ? `Next in ${untilTomorrowUtc()}: +${checkinReward(rewardBase, streak + 1) / ONE} SKR`
                  : `+${nextReward} SKR and +1 score point. Rewards grow to 7× with your streak.`}
              </Text>
            </View>
          </View>
          <View style={s.week}>
            {Array.from({ length: 7 }).map((_, i) => {
              const filled = i < Math.min(shownStreak, 7);
              return (
                <View key={i} style={[s.weekDot, filled && { backgroundColor: color.lime, borderColor: color.lime }]}>
                  <Text size={11} weight="bold" color={filled ? color.onLime : color.dim}>
                    {i + 1}×
                  </Text>
                </View>
              );
            })}
          </View>
          {!a.checkedInToday ? (
            <Button testID="clock-in" title="Clock in" loading={busy === "checkin"} onPress={clockIn} style={{ marginTop: 14 }} />
          ) : null}
        </Card>

        {/* What's due */}
        {due.length ? (
          <>
            <SectionTitle title="Due next" action="All plans" onAction={() => router.push("/(tabs)/credit")} />
            <Card style={{ paddingVertical: 4 }}>
              {due.slice(0, 2).map(({ pl, at, amount }) => (
                <Row
                  key={pl.address.toBase58()}
                  onPress={() => router.push({ pathname: "/plan", params: { index: String(pl.index) } })}
                  icon={
                    <View style={[s.icon, { backgroundColor: color.purple }]}>
                      <Ionicons name="calendar" size={18} color="#fff" />
                    </View>
                  }
                  title={merchantName(pl.merchant)}
                  meta={`Pay in 4 · ${pl.paid + 1} of 4 · ${fmtDue(at)}`}
                  right={fmtUsd(amount)}
                />
              ))}
            </Card>
          </>
        ) : null}

        {/* SKR */}
        <SectionTitle title="SKR" action="Lock to raise limit" onAction={() => router.push("/skr")} />
        <Pressable onPress={() => router.push("/skr")}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[s.icon, { backgroundColor: "#1f2a12" }]}>
              <Ionicons name="sparkles" size={18} color={color.lime} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="medium">{fmtSkr(a.skr)}</Text>
              <Text size={12} color={color.muted}>
                {fmtSkr(p?.skrLocked.toNumber() ?? 0)} locked · {fmtSkr(p?.skrEarned.toNumber() ?? 0)} earned clocking in
              </Text>
            </View>
            <Tag label="devnet stand-in" />
          </Card>
        </Pressable>

        {/* Activity, read from the chain */}
        <SectionTitle title="Recent activity" />
        <Card style={{ paddingVertical: 4 }}>
          {a.activity.length === 0 ? (
            <Text size={13} color={color.muted} style={{ paddingVertical: 14 }}>
              Nothing yet. Tap Add for test dollars, then clock in.
            </Text>
          ) : (
            a.activity.slice(0, 8).map((x) => (
              <Row
                key={x.sig}
                onPress={() => Linking.openURL(explorerTx(x.sig))}
                icon={
                  <View style={[s.icon, { backgroundColor: color.surface3 }]}>
                    <Ionicons name={ICON[x.kind] ?? "ellipse"} size={17} color={color.text} />
                  </View>
                }
                title={x.title}
                meta={new Date(x.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                right={x.usdDelta ? `${x.usdDelta > 0 ? "+" : "−"}${fmtUsd(Math.abs(x.usdDelta))}` : x.skrDelta ? `${x.skrDelta > 0 ? "+" : "−"}${fmtSkr(Math.abs(x.skrDelta))}` : ""}
                rightColor={x.usdDelta > 0 || (!x.usdDelta && x.skrDelta > 0) ? color.up : color.text}
              />
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const ICON: Record<string, any> = {
  Pay: "bag-check",
  OpenPlan: "calendar",
  RepayInstallment: "checkmark-done",
  RepayWithSkr: "sparkles",
  CollectDue: "checkmark-done",
  CheckIn: "time",
  LockSkr: "lock-closed",
  UnlockSkr: "lock-open",
  CreateLink: "link",
  ClaimLink: "gift",
  CancelLink: "arrow-undo",
  Faucet: "water",
  InitProfile: "person-add",
};

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: color.surface1, paddingHorizontal: 10, height: 30, borderRadius: 15 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  lime: { backgroundColor: color.lime, borderRadius: radius.card, padding: 18 },
  inkPill: { backgroundColor: "#111", borderRadius: 999, paddingHorizontal: 12, height: 30, justifyContent: "center" },
  actions: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  action: { alignItems: "center", gap: 6, flex: 1 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: color.warn + "44" },
  ringLabel: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  weekDot: { width: 38, height: 30, borderRadius: 10, borderWidth: 1, borderColor: color.hairlineStrong, alignItems: "center", justifyContent: "center" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
