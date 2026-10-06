import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Button, Card, Row, SectionTitle, Tag, Text } from "../../src/ui/kit";
import { color, font, gutter, radius } from "../../src/ui/theme";
import { explainError, useWallet } from "../../src/wallet/WalletProvider";
import { useAccount } from "../../src/state/AccountProvider";
import { CLUSTER, PROGRAM_ID, RPC_URL, SKR_MINT, USD_MINT } from "../../src/lib/config";
import { COACH_URL, getCoachKey, setCoachKey } from "../../src/lib/coach";
import { useToast } from "../../src/ui/Toast";
import { ensurePermission, scheduleClockInReminder } from "../../src/lib/notify";
import { checkinReward, ONE } from "../../src/lib/credit";
import { useSeeker } from "../../src/lib/seeker";

export default function Me() {
  const router = useRouter();
  const { publicKey, walletLabel, kind, disconnect, requestAirdrop } = useWallet();
  const a = useAccount();
  const toast = useToast();
  const seeker = useSeeker(kind === "mwa" ? publicKey : null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [airdropping, setAirdropping] = useState(false);
  const addr = publicKey?.toBase58() ?? "";

  useEffect(() => {
    getCoachKey().then((k) => setHasKey(!!k));
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: gutter, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text weight="bold" size={30}>
          Me
        </Text>

        <Card style={{ marginTop: 12, alignItems: "center", gap: 10 }}>
          <View style={s.qr}>{addr ? <QRCode value={addr} size={150} /> : null}</View>
          <Text size={13} color={color.muted}>
            Your code for getting paid
          </Text>
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(addr);
              toast({ kind: "ok", text: "Address copied" });
            }}
            style={s.addr}
          >
            <Text size={13} weight="medium">
              {addr.slice(0, 6)}…{addr.slice(-6)}
            </Text>
            <Ionicons name="copy-outline" size={14} color={color.muted} />
          </Pressable>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            <Tag label={walletLabel ?? ""} tone={kind === "guest" ? "warn" : "lime"} />
            {seeker.verified ? <Tag label="Seeker verified" tone="lime" /> : seeker.device ? <Tag label="Seeker device" tone="lime" /> : null}
          </View>
        </Card>

        <SectionTitle title="Network" />
        <Card style={{ paddingVertical: 4 }}>
          <Row title="Solana" meta={RPC_URL} right={CLUSTER} />
          <Row
            title="Fee balance"
            meta="Network fees are paid in SOL"
            right={`${(a.sol / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
            onPress={async () => {
              setAirdropping(true);
              try {
                await requestAirdrop();
                toast({ kind: "ok", text: "Devnet SOL added" });
                a.refresh();
              } catch (e) {
                toast({ kind: "error", text: explainError(e) });
              } finally {
                setAirdropping(false);
              }
            }}
            rightMeta={airdropping ? "requesting…" : "tap for devnet SOL"}
          />
          <Row title="Program" meta={PROGRAM_ID.toBase58()} onPress={() => Linking.openURL(`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`)} />
          <Row title="pUSD (test dollars)" meta={USD_MINT.toBase58()} />
          <Row title="SKR (devnet stand-in)" meta={SKR_MINT.toBase58()} />
        </Card>

        <SectionTitle title="Daily reminder" />
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name="notifications" size={18} color={color.lime} />
          <Text size={13} style={{ flex: 1 }}>
            A nudge at 9:00 to clock in, and the day before each instalment.
          </Text>
          <Pressable
            onPress={async () => {
              if (await ensurePermission()) {
                await scheduleClockInReminder(a.profile?.streak ?? 0, checkinReward(a.config?.checkinReward.toNumber() ?? 0, (a.profile?.streak ?? 0) + 1) / ONE);
                toast({ kind: "ok", text: "Reminder set for 9:00 tomorrow" });
              } else toast({ kind: "error", text: "Notifications are off for Polaris in Settings" });
            }}
          >
            <Text weight="bold" size={13} color={color.lime}>
              Turn on
            </Text>
          </Pressable>
        </Card>

        <SectionTitle title="Coach (AI)" />
        <Card style={{ gap: 10 }}>
          <Text size={13} color={color.muted} style={{ lineHeight: 19 }}>
            {COACH_URL
              ? `This build talks to a Polaris coach server (${COACH_URL}).`
              : "Coach uses Claude through your own Anthropic API key, kept in this phone's secure storage and sent only to api.anthropic.com. Without one, Coach answers from fixed rules."}
          </Text>
          {!COACH_URL ? (
            hasKey ? (
              <Button
                title="Remove API key"
                kind="ghost"
                onPress={async () => {
                  await setCoachKey(null);
                  setHasKey(false);
                }}
              />
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  value={key}
                  onChangeText={setKey}
                  placeholder="sk-ant-…"
                  placeholderTextColor={color.dim}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={s.input}
                />
                <Button
                  title="Save"
                  disabled={key.length < 20}
                  style={{ paddingHorizontal: 18 }}
                  onPress={async () => {
                    await setCoachKey(key);
                    setKey("");
                    setHasKey(true);
                    toast({ kind: "ok", text: "Coach is on" });
                  }}
                />
              </View>
            )
          ) : null}
        </Card>

        <SectionTitle title="About" />
        <Card>
          <Text size={13} color={color.muted} style={{ lineHeight: 19 }}>
            Polaris: pay now, Pay in 4 against a credit line you grow on chain, and send dollars by link. Built for Solana
            Mobile; everything here runs on Solana {CLUSTER} with test money. Not financial advice.
          </Text>
        </Card>

        <Button
          title="Disconnect"
          kind="ghost"
          style={{ marginTop: 20 }}
          onPress={async () => {
            await disconnect();
            router.replace("/onboarding");
          }}
        />
        {kind === "guest" ? (
          <Text size={11} color={color.dim} style={{ textAlign: "center", marginTop: 8 }}>
            The guest key stays on this phone, so reconnecting brings the same account back.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  qr: { backgroundColor: "#fff", padding: 12, borderRadius: 18 },
  addr: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: color.surface2, paddingHorizontal: 12, height: 32, borderRadius: radius.pill },
  input: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    paddingHorizontal: 18,
    color: color.text,
    fontFamily: font.regular,
  },
});
