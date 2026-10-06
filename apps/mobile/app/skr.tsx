import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Pill, Tag, Text } from "../src/ui/kit";
import { color, gutter, radius } from "../src/ui/theme";
import { useAccount } from "../src/state/AccountProvider";
import { useAction } from "../src/state/useAction";
import { useWallet } from "../src/wallet/WalletProvider";
import { ix } from "../src/chain/polaris";
import { creditLimit, fmtSkr, fmtUsd, ONE, skrBoost } from "../src/lib/credit";
import { PARAMS, SKR_MAINNET_MINT, SKR_MINT } from "../src/lib/config";

export default function SkrScreen() {
  const router = useRouter();
  const a = useAccount();
  const { publicKey } = useWallet();
  const { run, busy } = useAction();
  const [mode, setMode] = useState<"lock" | "unlock">("lock");
  const locked = a.profile?.skrLocked.toNumber() ?? 0;
  const price = a.config?.skrPriceMicros.toNumber() ?? PARAMS.skrPriceMicros;
  const bps = a.config?.skrCollateralBps ?? PARAMS.skrCollateralBps;
  const max = mode === "lock" ? a.skr : locked;
  const presets = [250, 1_000, 2_500].map((x) => x * ONE).filter((x) => x <= max);
  const [amount, setAmount] = useState(0);
  const amt = Math.min(amount, max);
  const after = creditLimit(a.score, mode === "lock" ? locked + amt : locked - amt, price, bps);
  const debt = a.profile?.activeDebt.toNumber() ?? 0;
  const blocked = mode === "unlock" && after < debt;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.grabber} />
      <View style={s.top}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-down" size={24} color={color.text} />
        </Pressable>
        <Text weight="bold" size={17}>
          SKR collateral
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: gutter }}>
        <View style={s.hero}>
          <Text size={13} color={color.onLime} weight="medium">
            Locked
          </Text>
          <Text weight="bold" size={36} color={color.onLime}>
            {fmtSkr(locked)}
          </Text>
          <Text size={13} color="rgba(15,16,17,0.7)">
            adds {fmtUsd(skrBoost(locked, price, bps))} to your Pay in 4 limit
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Card style={{ flex: 1 }}>
            <Text size={12} color={color.muted}>
              In your wallet
            </Text>
            <Text weight="bold" size={17}>
              {fmtSkr(a.skr)}
            </Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <Text size={12} color={color.muted}>
              Limit now
            </Text>
            <Text weight="bold" size={17}>
              {fmtUsd(a.limit, 0)}
            </Text>
          </Card>
        </View>

        <View style={s.seg}>
          {(["lock", "unlock"] as const).map((m) => (
            <Pressable key={m} onPress={() => (setMode(m), setAmount(0))} style={[s.segBtn, mode === m && { backgroundColor: color.text }]}>
              <Text weight="bold" size={14} color={mode === m ? color.onLime : color.muted}>
                {m === "lock" ? "Lock" : "Unlock"}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {presets.map((p) => (
            <Pill key={p} label={fmtSkr(p)} active={amount === p} onPress={() => setAmount(p)} />
          ))}
          {max > 0 ? <Pill label={`All · ${fmtSkr(max)}`} active={amount === max} onPress={() => setAmount(max)} /> : null}
        </View>
        {amt > 0 ? (
          <Card style={{ marginTop: 12 }}>
            <Text size={13} color={blocked ? color.down : color.text}>
              {blocked
                ? `That SKR backs what you owe (${fmtUsd(debt)}). Pay down a plan first.`
                : `Your limit goes from ${fmtUsd(a.limit, 0)} to ${fmtUsd(after, 0)}.`}
            </Text>
          </Card>
        ) : null}

        <Card style={{ marginTop: 16, gap: 8 }}>
          <Text weight="bold">How SKR works in Polaris</Text>
          <Text size={13} color={color.muted} style={{ lineHeight: 19 }}>
            Earn it by clocking in every day. Lock it and half its dollar value is added to your Pay in 4 limit; it unlocks
            whenever what's left still covers what you owe. Or spend it: any instalment can be paid in SKR.
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <Tag label="SKR (devnet stand-in)" tone="warn" />
            <Tag label={`priced at ${fmtUsd(price, 3)} (stand-in)`} />
          </View>
          <Text size={11} color={color.dim}>
            Devnet mint {SKR_MINT.toBase58().slice(0, 8)}…; on mainnet this is Seeker's SKR ({SKR_MAINNET_MINT.slice(0, 8)}…) and the price would come
            from an oracle.
          </Text>
        </Card>
      </ScrollView>
      <View style={{ padding: gutter }}>
        <Button
          testID="skr-confirm"
          title={amt > 0 ? `${mode === "lock" ? "Lock" : "Unlock"} ${fmtSkr(amt)}` : "Choose an amount"}
          disabled={amt <= 0 || blocked}
          loading={busy === "skr"}
          onPress={async () => {
            const sig = await run(
              "skr",
              async () =>
                mode === "lock"
                  ? [ix.ensureSkrAta(publicKey!, publicKey!), await ix.lockSkr(publicKey!, amt)]
                  : [ix.ensureSkrAta(publicKey!, publicKey!), await ix.unlockSkr(publicKey!, amt)],
              mode === "lock" ? `Locked ${fmtSkr(amt)}: limit ${fmtUsd(after, 0)}` : `Unlocked ${fmtSkr(amt)}`,
            );
            if (sig) setAmount(0);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: color.surface3, marginTop: 8 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: gutter, paddingVertical: 10 },
  hero: { backgroundColor: color.lime, borderRadius: radius.card, padding: 20 },
  seg: { flexDirection: "row", backgroundColor: color.surface1, borderRadius: radius.pill, padding: 4, marginTop: 16 },
  segBtn: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
