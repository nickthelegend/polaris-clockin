import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Money, Text } from "../src/ui/kit";
import { color, gutter } from "../src/ui/theme";
import { useAccount } from "../src/state/AccountProvider";
import { useAction } from "../src/state/useAction";
import { useWallet } from "../src/wallet/WalletProvider";
import { ix, merchantName } from "../src/chain/polaris";
import { dueAt, fmtSkr, fmtUsd, installmentAmount, ONE, skrForUsd } from "../src/lib/credit";
import { PARAMS } from "../src/lib/config";

export default function PlanScreen() {
  const { index } = useLocalSearchParams<{ index: string }>();
  const router = useRouter();
  const a = useAccount();
  const { publicKey } = useWallet();
  const { run, busy } = useAction();
  const pl = a.plans.find((x) => x.index === Number(index));

  if (!pl) {
    return (
      <SafeAreaView style={s.root}>
        <Text style={{ padding: 24 }} color={color.muted}>
          Loading plan…
        </Text>
      </SafeAreaView>
    );
  }
  const total = pl.totalOwed.toNumber();
  const repaid = pl.repaid.toNumber();
  const next = pl.paid < 4 ? installmentAmount(total, repaid, pl.paid) : 0;
  const price = a.config?.skrPriceMicros.toNumber() ?? PARAMS.skrPriceMicros;
  const nextSkr = skrForUsd(next, price);
  const grace = a.config?.graceSecs.toNumber() ?? PARAMS.graceSecs;
  const at = dueAt(pl.startedAt.toNumber(), pl.intervalSecs.toNumber(), pl.paid);
  const onTime = Date.now() / 1000 <= at + grace;
  const name = merchantName(pl.merchant);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.grabber} />
      <View style={s.top}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-down" size={24} color={color.text} />
        </Pressable>
        <Text weight="bold" size={17}>
          {name} · Pay in 4
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: gutter }}>
        <Card>
          <Text size={13} color={color.muted}>
            Left to pay
          </Text>
          <Money value={(total - repaid) / ONE} size={38} />
          <Text size={12} color={color.muted} style={{ marginTop: 4 }}>
            {fmtUsd(pl.principal.toNumber())} + {fmtUsd(total - pl.principal.toNumber())} interest · {name} was paid in full
          </Text>
        </Card>
        <Card style={{ marginTop: 10 }}>
          {[0, 1, 2, 3].map((i) => {
            const d = dueAt(pl.startedAt.toNumber(), pl.intervalSecs.toNumber(), i);
            const paid = i < pl.paid;
            const amt = i === 3 ? total - Math.floor(total / 4) * 3 : Math.floor(total / 4);
            return (
              <View key={i} style={s.inst}>
                <Ionicons
                  name={paid ? "checkmark-circle" : i === pl.paid ? "ellipse-outline" : "ellipse-outline"}
                  size={20}
                  color={paid ? color.lime : i === pl.paid ? color.text : color.dim}
                />
                <View style={{ flex: 1 }}>
                  <Text weight="medium">{["First", "Second", "Third", "Fourth"][i]} payment</Text>
                  <Text size={12} color={color.muted}>
                    {new Date(d * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    {paid ? " · paid" : i === pl.paid ? " · next" : ""}
                  </Text>
                </View>
                <Text weight="medium" color={paid ? color.muted : color.text}>
                  {fmtUsd(amt)}
                </Text>
              </View>
            );
          })}
        </Card>
        {pl.paid < 4 ? (
          <Card style={{ marginTop: 10, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Ionicons name={onTime ? "trending-up" : "alert-circle"} size={18} color={onTime ? color.lime : color.warn} />
            <Text size={13} style={{ flex: 1 }}>
              {onTime
                ? `Pay now and it counts as on time: +12 on your score${pl.paid === 3 ? ", +10 for finishing the plan" : ""}.`
                : "This instalment is past its grace period: paying now still clears it."}
            </Text>
          </Card>
        ) : (
          <Card style={{ marginTop: 10 }}>
            <Text size={13} color={color.lime}>
              Paid off. Nice.
            </Text>
          </Card>
        )}
      </ScrollView>
      {pl.paid < 4 ? (
        <View style={{ padding: gutter, gap: 10 }}>
          <Button
            testID="repay"
            title={`Pay ${fmtUsd(next)}`}
            disabled={a.usd < next}
            loading={busy === "repay"}
            onPress={() => run("repay", async () => [await ix.repay(publicKey!, pl.index)], `Instalment ${pl.paid + 1} of 4 paid`)}
          />
          <Button
            testID="repay-skr"
            title={`Pay with ${fmtSkr(nextSkr)}`}
            kind="ink"
            disabled={a.skr < nextSkr}
            loading={busy === "repay-skr"}
            onPress={() =>
              run("repay-skr", async () => [await ix.repayWithSkr(publicKey!, pl.index)], `Paid in SKR: instalment ${pl.paid + 1} of 4`)
            }
          />
          <Text size={11} color={color.dim} style={{ textAlign: "center" }}>
            SKR is valued at {fmtUsd(price, 3)} (devnet stand-in price); what you pay in SKR funds tomorrow's clock-in rewards.
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: color.surface3, marginTop: 8 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: gutter, paddingVertical: 10 },
  inst: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
});
