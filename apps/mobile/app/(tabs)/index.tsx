import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Button, Card, Money, Row, SectionTitle, StateBlock, Tag, Text, useTabBarSpace } from "../../src/ui/kit";
import { StreakRing } from "../../src/ui/Art";
import { color, gutter, radius } from "../../src/ui/theme";
import { useAccount } from "../../src/state/AccountProvider";
import { useAction } from "../../src/state/useAction";
import { useWallet, explainError } from "../../src/wallet/WalletProvider";
import { ix, merchantName } from "../../src/chain/polaris";
import { CLUSTER, PARAMS, SKR_MINT, USD_MINT, explorerTx } from "../../src/lib/config";
import { checkinReward, dueAt, fmtDue, fmtSkr, fmtUsd, installmentAmount, ONE, today } from "../../src/lib/credit";
import { scheduleClockInReminder, syncDailyReminders } from "../../src/lib/notify";
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
  const bottom = useTabBarSpace();
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
  const lowSol = a.loaded && !a.error && a.sol < 0.003 * LAMPORTS_PER_SOL;

  // Keep the 9:00 nudge and the 20:00 streak-at-risk reminder in line with today.
  useEffect(() => {
    if (!a.loaded || a.error) return;
    syncDailyReminders({ checkedInToday: a.checkedInToday, streak: shownStreak, nextRewardSkr: nextReward }).catch(() => {});
  }, [a.loaded, a.checkedInToday, shownStreak, nextReward, a.error]);

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
    if (sig) scheduleClockInReminder(nextStreak, checkinReward(rewardBase, nextStreak + 1) / ONE).catch(() => {});
  }

  async function addMoney() {
    await run(
      "faucet",
      async () => [await ix.faucet(publicKey!, USD_MINT, 250 * ONE), await ix.faucet(publicKey!, SKR_MINT, 500 * ONE)],
      "Added $250 test dollars and 500 SKR",
    );
  }

  async function getSol() {
    try {
      await requestAirdrop();
      toast({ kind: "ok", text: `${CLUSTER} SOL added for fees` });
      a.refresh();
    } catch (e) {
      toast({ kind: "error", text: explainError(e) });
      if (CLUSTER === "devnet") Linking.openURL("https://faucet.solana.com");
    }
  }

  const days = Array.from({ length: 7 }).map((_, i) => ({
    n: i + 1,
    reward: checkinReward(rewardBase, i + 1) / ONE,
    done: i < Math.min(shownStreak, 7),
    next: !a.checkedInToday && i === Math.min(nextStreak, 7) - 1,
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: gutter, paddingBottom: bottom }}
        refreshControl={<RefreshControl refreshing={a.loading && a.loaded} onRefresh={a.refresh} tintColor={color.muted} />}
      >
        <View style={s.header}>
          <Image
            source={require("../../assets/wordmark.png")}
            style={{ width: 96, height: 30 }}
            resizeMode="contain"
            accessibilityLabel="Polaris"
          />
          <Pressable
            onPress={() => router.push("/(tabs)/me")}
            style={s.chip}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Wallet ${publicKey?.toBase58().slice(0, 4)}, ${kind === "guest" ? "guest wallet" : "connected wallet"}, ${CLUSTER}`}
          >
            <View style={[s.dot, { backgroundColor: kind === "guest" ? color.warn : color.lime }]} />
            <Text size={13} weight="medium" color={color.muted}>
              {publicKey?.toBase58().slice(0, 4)}…{publicKey?.toBase58().slice(-4)} · {CLUSTER}
            </Text>
          </Pressable>
        </View>

        {a.error ? (
          <View style={{ marginBottom: 12 }}>
            <StateBlock
              tone="down"
              icon={<Ionicons name={a.offline ? "cloud-offline" : "warning"} size={20} color={color.down} />}
              title={a.offline ? `Can't reach Solana ${CLUSTER}` : "Couldn't read your account"}
              body={a.offline ? "Check your connection. Your money is safe on chain; nothing was sent." : "The Polaris program didn't answer as expected."}
              action={a.loading ? "…" : "Retry"}
              onAction={a.refresh}
            />
          </View>
        ) : null}

        {/* Dollar account */}
        <View style={s.lime}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={s.inkPill}>
              <Text size={13} weight="medium">
                Dollar account
              </Text>
            </View>
            <Text size={13} weight="medium" color="rgba(15,16,17,0.65)">
              pUSD · test dollars
            </Text>
          </View>
          <View style={{ marginTop: 18, minHeight: 56, justifyContent: "center" }}>
            {a.loaded ? (
              <Money value={a.usd / ONE} size={48} color={color.onLime} />
            ) : (
              <ActivityIndicator color={color.onLime} style={{ alignSelf: "flex-start" }} accessibilityLabel="Loading balance" />
            )}
          </View>
          <View style={s.actions}>
            {[
              { icon: "add", label: "Add", on: addMoney, id: "faucet" },
              { icon: "arrow-up", label: "Send", on: () => router.push("/send") },
              { icon: "bag-handle", label: "Shop", on: () => router.push("/(tabs)/shop") },
              { icon: "pulse", label: "Credit", on: () => router.push("/(tabs)/credit") },
            ].map((b) => (
              <Pressable
                key={b.label}
                testID={`home-${b.label}`}
                onPress={b.on}
                style={({ pressed }) => [s.action, pressed && { transform: [{ scale: 0.95 }] }]}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel={b.id === "faucet" ? "Add test dollars and SKR" : b.label}
              >
                <View style={s.actionIcon}>
                  {busy === b.id ? <ActivityIndicator color={color.text} /> : <Ionicons name={b.icon as any} size={22} color={color.text} />}
                </View>
                <Text size={13} weight="medium" color={color.onLime}>
                  {b.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {lowSol ? (
          <View style={{ marginTop: 12 }}>
            <StateBlock
              tone="warn"
              icon={<Ionicons name="flash" size={20} color={color.warn} />}
              title="Add SOL for network fees"
              body={`Every action costs a fraction of a cent in SOL. You have ${(a.sol / LAMPORTS_PER_SOL).toFixed(4)}.`}
              action="Get SOL"
              onAction={getSol}
            />
          </View>
        ) : null}

        {/* The daily loop */}
        <Card style={{ marginTop: 12, padding: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View accessible accessibilityLabel={`${shownStreak} day streak`}>
              <StreakRing days={shownStreak} size={68} />
              <View style={s.ringLabel}>
                <Text weight="bold" size={22}>
                  {shownStreak}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="bold" size={18}>
                {a.checkedInToday ? "Clocked in today" : shownStreak > 0 ? `Day ${Math.min(shownStreak + 1, 99)} is waiting` : "Clock in"}
              </Text>
              <Text size={14} color={color.muted} style={{ marginTop: 3, lineHeight: 19 }}>
                {a.checkedInToday
                  ? `Next in ${untilTomorrowUtc()} pays ${checkinReward(rewardBase, streak + 1) / ONE} SKR`
                  : shownStreak > 0
                    ? `Keep the streak: ${nextReward} SKR and +1 score point today.`
                    : `${nextReward} SKR and +1 score point. Rewards grow every day for a week.`}
              </Text>
            </View>
          </View>
          <View style={s.week} accessible accessibilityLabel={`Rewards by streak day, day 1 ${days[0].reward} SKR up to day 7 ${days[6].reward} SKR`}>
            {days.map((d) => (
              <View key={d.n} style={s.dayCol}>
                <View style={[s.day, d.done && s.dayDone, d.next && s.dayNext]}>
                  {d.done ? (
                    <Ionicons name="checkmark" size={18} color={color.onLime} />
                  ) : (
                    <Text size={13} weight="bold" color={d.next ? color.lime : color.muted}>
                      {d.n}
                    </Text>
                  )}
                </View>
                <Text size={12} weight="medium" color={d.done || d.next ? color.text : color.dim}>
                  +{d.reward}
                </Text>
              </View>
            ))}
          </View>
          {!a.checkedInToday ? (
            <Button
              testID="clock-in"
              title={`Clock in · +${nextReward} SKR`}
              loading={busy === "checkin"}
              disabled={!a.loaded || !!a.error}
              onPress={clockIn}
              style={{ marginTop: 16 }}
            />
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
        <Pressable onPress={() => router.push("/skr")} accessibilityRole="button" accessibilityLabel="SKR collateral">
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={[s.icon, { backgroundColor: "#1f2a12" }]}>
              <Ionicons name="sparkles" size={18} color={color.lime} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="bold" size={16}>
                {fmtSkr(a.skr)}
              </Text>
              <Text size={13} color={color.muted} style={{ marginTop: 2 }}>
                {fmtSkr(p?.skrLocked.toNumber() ?? 0)} locked · {fmtSkr(p?.skrEarned.toNumber() ?? 0)} earned
              </Text>
            </View>
            <Tag label="devnet stand-in" tone="warn" />
          </Card>
        </Pressable>

        {/* Activity, read from the chain */}
        <SectionTitle title="Recent activity" />
        {a.activity.length === 0 ? (
          <StateBlock
            icon={<Ionicons name="time-outline" size={20} color={color.muted} />}
            title={a.loaded ? "Nothing here yet" : "Loading activity…"}
            body={a.loaded ? "Tap Add for test dollars, then clock in. Every action shows up here with a link to the explorer." : undefined}
          />
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {a.activity.slice(0, 8).map((x) => (
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
                right={
                  x.usdDelta
                    ? `${x.usdDelta > 0 ? "+" : "−"}${fmtUsd(Math.abs(x.usdDelta))}`
                    : x.skrDelta
                      ? `${x.skrDelta > 0 ? "+" : "−"}${fmtSkr(Math.abs(x.skrDelta))}`
                      : ""
                }
                rightColor={x.usdDelta > 0 || (!x.usdDelta && x.skrDelta > 0) ? color.up : color.text}
              />
            ))}
          </Card>
        )}
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, minHeight: 44 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: color.surface1, paddingHorizontal: 12, minHeight: 36, borderRadius: 18 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  lime: { backgroundColor: color.lime, borderRadius: radius.card, padding: 18 },
  inkPill: { backgroundColor: "#111", borderRadius: 999, paddingHorizontal: 12, height: 32, justifyContent: "center" },
  actions: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  action: { alignItems: "center", gap: 6, flex: 1, minHeight: 72 },
  actionIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  ringLabel: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  dayCol: { alignItems: "center", gap: 6 },
  day: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: color.hairlineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDone: { backgroundColor: color.lime, borderColor: color.lime },
  dayNext: { borderColor: color.lime, borderStyle: "dashed" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
