import React from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Card, Money, Screen, SectionTitle, Stat, StateBlock, Text, useCountUp } from "../../src/ui/kit";
import { color, radius } from "../../src/ui/theme";
import { useAccount } from "../../src/state/AccountProvider";
import { merchantName } from "../../src/chain/polaris";
import { dueAt, fmtDue, fmtUsd, installmentAmount, nextTier, ONE, tierOf, TIERS } from "../../src/lib/credit";

export default function Credit() {
  const router = useRouter();
  const a = useAccount();
  const p = a.profile;
  const tier = tierOf(a.score);
  const next = nextTier(a.score);
  const lo = 300;
  const hi = 850;
  const frac = (a.score - lo) / (hi - lo);
  const debt = p?.activeDebt.toNumber() ?? 0;
  const open = a.plans.filter((pl) => pl.paid < pl.installments);
  const closed = a.plans.filter((pl) => pl.paid >= pl.installments);
  const shownScore = Math.round(useCountUp(a.score, 800));

  return (
    <Screen
      title="Credit"
      subtitle="Your score lives on chain and moves with every action."
      scrollProps={{ refreshControl: <RefreshControl refreshing={a.loading && a.loaded} onRefresh={a.refresh} tintColor={color.muted} /> }}
    >

        {/* Score card */}
        <LinearGradient colors={["#9a63ff", "#6a17ee"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.purple}>
          <Text weight="bold" size={64} color="#fff" style={{ letterSpacing: -3, fontVariant: ["tabular-nums"] }} accessibilityLabel={`Credit score ${a.score}`}>
            {shownScore}
          </Text>
          <View style={s.bandPill}>
            <Text size={13} weight="bold" color="#fff">
              {tier.band}
              {next ? ` · ${next.min - a.score} to ${next.band}` : ""}
            </Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.max(4, frac * 100)}%` }]} />
            {TIERS.slice(0, -1).map((t) => (
              <View key={t.min} style={[s.tick, { left: `${((t.min - lo) / (hi - lo)) * 100}%` }]} />
            ))}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text size={12} color="rgba(255,255,255,0.75)">
              300
            </Text>
            <Text size={12} color="rgba(255,255,255,0.75)">
              850
            </Text>
          </View>
        </LinearGradient>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Stat label="On time" value={String(p?.onTime ?? 0)} />
          <Stat label="Your line" value={fmtUsd(tier.limit * ONE, 0)} />
          <Stat label="Next tier" value={next ? fmtUsd(next.limit * ONE, 0) : "Top"} tone={color.lime} />
        </View>

        {/* Available to spend */}
        <LinearGradient colors={[color.crimsonFrom, color.crimsonTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.crimson}>
          <Text size={14} weight="medium" color="rgba(255,255,255,0.9)">
            Available to spend
          </Text>
          <Money value={a.available / ONE} size={40} color="#fff" />
          <View style={s.ofPill}>
            <Text size={13} weight="medium" color="#fff">
              of {fmtUsd(a.limit, 0)} · 10% APR · {fmtUsd(debt)} in use
            </Text>
          </View>
        </LinearGradient>

        <Pressable onPress={() => router.push("/skr")} accessibilityRole="button" accessibilityLabel="Boost with SKR">
          <Card style={s.skrRow}>
            <Ionicons name="lock-closed" size={18} color={color.lime} />
            <View style={{ flex: 1 }}>
              <Text weight="medium">Boost with SKR</Text>
              <Text size={13} color={color.muted}>
                {a.limit - tier.limit * ONE > 0
                  ? `Locked SKR adds ${fmtUsd(a.limit - tier.limit * ONE)} to your limit`
                  : "Lock SKR: half its value is added to your limit"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={color.muted} />
          </Card>
        </Pressable>

        <SectionTitle title="Active plans" />
        {open.length === 0 ? (
          <StateBlock
            icon={<Ionicons name="calendar-outline" size={20} color={color.purpleText} />}
            title="No plans yet"
            body="Choose Pay in 4 at checkout: the shop is paid in full today, you pay in four weeks."
            action="Shop"
            onAction={() => router.push("/(tabs)/shop")}
          />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {open.map((pl) => {
              const at = dueAt(pl.startedAt.toNumber(), pl.intervalSecs.toNumber(), pl.paid);
              return (
                <Pressable
                  key={pl.address.toBase58()}
                  testID={`plan-${pl.index}`}
                  onPress={() => router.push({ pathname: "/plan", params: { index: String(pl.index) } })}
                  accessibilityRole="button"
                  style={s.planCard}
                >
                  <Text weight="bold">{merchantName(pl.merchant)}</Text>
                  <Text size={13} color={color.muted}>
                    Pay in 4 · {pl.paid} of 4 paid
                  </Text>
                  <Text weight="bold" size={22} style={{ marginTop: 12 }}>
                    {fmtUsd(pl.totalOwed.toNumber() - pl.repaid.toNumber())}
                  </Text>
                  <Text size={13} color={color.muted}>
                    Next {fmtUsd(installmentAmount(pl.totalOwed.toNumber(), pl.repaid.toNumber(), pl.paid))} · {fmtDue(at)}
                  </Text>
                  <View style={s.bars}>
                    {[0, 1, 2, 3].map((i) => (
                      <View key={i} style={[s.bar, { backgroundColor: i < pl.paid ? color.lime : color.track }]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <SectionTitle title="How your score moves" />
        <Card style={{ gap: 10 }}>
          {[
            ["checkmark-done", "+12", "Each instalment paid on time (early counts)"],
            ["trophy", "+10", "A plan paid off"],
            ["time", "+1", "Each daily clock-in (first 60)"],
            ["bag-check", "+2", "Pay now, $5 or more (first 10)"],
            ["alert-circle", "−30", "An instalment paid after the grace period"],
          ].map(([icon, pts, text]) => (
            <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name={icon as any} size={16} color={pts.startsWith("−") ? color.down : color.lime} />
              <Text weight="bold" size={14} style={{ width: 38 }} color={pts.startsWith("−") ? color.down : color.lime}>
                {pts}
              </Text>
              <Text size={14} color={color.muted} style={{ flex: 1 }}>
                {text}
              </Text>
            </View>
          ))}
        </Card>
        {closed.length ? (
          <Text size={13} color={color.muted} style={{ marginTop: 12 }}>
            {closed.length} plan{closed.length === 1 ? "" : "s"} paid off.
          </Text>
        ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  purple: { borderRadius: radius.card, padding: 20 },
  bandPill: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  track: { height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.18)", marginTop: 22, overflow: "hidden" },
  fill: { height: 10, borderRadius: 5, backgroundColor: "#d6ff8a" },
  tick: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: "rgba(15,16,17,0.35)" },
  crimson: { borderRadius: radius.card, padding: 20, marginTop: 12 },
  ofPill: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.18)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  skrRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  planCard: { width: "48%", flexGrow: 1, backgroundColor: color.surface1, borderRadius: radius.surface, padding: 14 },
  bars: { flexDirection: "row", gap: 4, marginTop: 12 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
});
