import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Button, Card, Row, Screen, SectionTitle, Tag, Text, ToggleRow } from "../../src/ui/kit";
import { color, font, radius } from "../../src/ui/theme";
import { explainError, useWallet } from "../../src/wallet/WalletProvider";
import { useAccount } from "../../src/state/AccountProvider";
import { CLUSTER, PROGRAM_ID, RPC_URL, SKR_MINT, USD_MINT } from "../../src/lib/config";
import { COACH_URL, getCoachKey, setCoachKey } from "../../src/lib/coach";
import { useToast } from "../../src/ui/Toast";
import { cancelDueReminders, getPrefs, ReminderPrefs, setPrefs, syncDailyReminders } from "../../src/lib/notify";
import { checkinReward, ONE, today } from "../../src/lib/credit";
import { useSeeker } from "../../src/lib/seeker";

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

export default function Me() {
  const router = useRouter();
  const { publicKey, walletLabel, kind, disconnect, requestAirdrop } = useWallet();
  const a = useAccount();
  const toast = useToast();
  const seeker = useSeeker(kind === "mwa" ? publicKey : null);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [airdropping, setAirdropping] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [prefs, setP] = useState<ReminderPrefs | null>(null);
  const addr = publicKey?.toBase58() ?? "";
  const params = useLocalSearchParams<{ advanced?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (params.advanced === "1") {
      setAdvanced(true);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 300);
    }
  }, [params.advanced]);

  useEffect(() => {
    getCoachKey().then((k) => setHasKey(!!k));
    getPrefs().then(setP);
  }, []);

  async function updatePrefs(next: ReminderPrefs) {
    setP(next);
    await setPrefs(next);
    if (!next.dueDates) await cancelDueReminders().catch(() => {});
    const streak = a.profile && a.profile.lastCheckInDay.toNumber() >= today() - 1 ? a.profile.streak : 0;
    await syncDailyReminders({
      checkedInToday: a.checkedInToday,
      streak,
      nextRewardSkr: checkinReward(a.config?.checkinReward.toNumber() ?? 0, streak + 1) / ONE,
      ask: true,
    }).catch(() => {});
  }

  async function copy(text: string, what: string) {
    await Clipboard.setStringAsync(text);
    toast({ kind: "ok", text: `${what} copied` });
  }

  return (
    <Screen title="Me" scrollProps={{ ref: scrollRef }}>
      {/* Wallet */}
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={s.qr} accessible accessibilityLabel="QR code of your address">
          {addr ? <QRCode value={addr} size={96} /> : null}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text weight="bold" size={17}>
            Your code for getting paid
          </Text>
          <Pressable onPress={() => copy(addr, "Address")} style={s.addr} accessibilityRole="button" accessibilityLabel="Copy address">
            <Text size={14} weight="medium">
              {short(addr)}
            </Text>
            <Ionicons name="copy-outline" size={15} color={color.muted} />
          </Pressable>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Tag label={walletLabel ?? ""} tone={kind === "guest" ? "warn" : "lime"} />
            {seeker.verified ? <Tag label="Seeker verified" tone="lime" /> : seeker.device ? <Tag label="Seeker" tone="lime" /> : null}
          </View>
        </View>
      </Card>

      {/* Reminders */}
      <SectionTitle title="Reminders" />
      <Card style={{ paddingVertical: 4 }}>
        {prefs ? (
          <>
            <ToggleRow
              testID="toggle-morning"
              title="Clock-in at 9:00"
              meta="A morning nudge with the day's SKR reward."
              value={prefs.morning}
              onChange={(v) => updatePrefs({ ...prefs, morning: v })}
            />
            <View style={s.divider} />
            <ToggleRow
              testID="toggle-streak"
              title="Streak at risk, 20:00"
              meta="Only on days you haven't clocked in yet."
              value={prefs.streakRisk}
              onChange={(v) => updatePrefs({ ...prefs, streakRisk: v })}
            />
            <View style={s.divider} />
            <ToggleRow
              testID="toggle-due"
              title="Instalment due tomorrow"
              meta="Paying early always counts as on time."
              value={prefs.dueDates}
              onChange={(v) => updatePrefs({ ...prefs, dueDates: v })}
            />
          </>
        ) : null}
      </Card>

      {/* Network fees */}
      <SectionTitle title="Network fees" />
      <Card style={{ paddingVertical: 4 }}>
        <Row
          title={`${(a.sol / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
          meta={`Fees on Solana ${CLUSTER} are paid in SOL, a fraction of a cent each.`}
          right={airdropping ? "Requesting…" : "Get SOL"}
          rightColor={color.lime}
          onPress={async () => {
            setAirdropping(true);
            try {
              await requestAirdrop();
              toast({ kind: "ok", text: `${CLUSTER} SOL added` });
              a.refresh();
            } catch (e) {
              toast({ kind: "error", text: explainError(e) });
            } finally {
              setAirdropping(false);
            }
          }}
        />
      </Card>

      {/* Coach key */}
      <SectionTitle title="Coach AI · optional" />
      <Card style={{ gap: 12 }}>
        <Text size={14} color={color.muted} style={{ lineHeight: 20 }}>
          {COACH_URL
            ? `This build's Coach runs on a Polaris server (${COACH_URL}).`
            : "Coach works without this. To have Claude answer, add your own Anthropic API key: it stays in this phone's secure storage (Keychain / Android Keystore), is never logged or shown again, and is sent only to api.anthropic.com."}
        </Text>
        {!COACH_URL ? (
          hasKey ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="checkmark-circle" size={20} color={color.lime} />
              <Text size={15} style={{ flex: 1 }}>
                Key saved. Coach uses Claude.
              </Text>
              <Pressable
                onPress={async () => {
                  await setCoachKey(null);
                  setHasKey(false);
                }}
                hitSlop={10}
                accessibilityRole="button"
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text weight="bold" size={14} color={color.down}>
                  Remove
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={key}
                onChangeText={setKey}
                placeholder="sk-ant-… (optional)"
                placeholderTextColor={color.muted}
                secureTextEntry
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                autoCapitalize="none"
                autoCorrect={false}
                style={s.input}
                accessibilityLabel="Anthropic API key, optional"
              />
              <Button
                title="Save"
                disabled={key.length < 20}
                style={{ paddingHorizontal: 18 }}
                onPress={async () => {
                  await setCoachKey(key);
                  setKey("");
                  setHasKey(true);
                  toast({ kind: "ok", text: "Coach now uses Claude" });
                }}
              />
            </View>
          )
        ) : null}
      </Card>

      {/* Advanced */}
      <Pressable
        onPress={() => setAdvanced((x) => !x)}
        style={s.advancedHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: advanced }}
      >
        <Text weight="bold" size={17}>
          Network & programs
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text size={14} color={color.muted}>
            Advanced
          </Text>
          <Ionicons name={advanced ? "chevron-up" : "chevron-down"} size={18} color={color.muted} />
        </View>
      </Pressable>
      {advanced ? (
        <Card style={{ paddingVertical: 4 }}>
          <Row title="Network" meta={`Solana ${CLUSTER}`} right={CLUSTER === "devnet" ? "devnet" : "local"} />
          <Row title="RPC" meta={RPC_URL} onPress={() => copy(RPC_URL, "RPC URL")} />
          <Row
            title="Polaris program"
            meta={short(PROGRAM_ID.toBase58())}
            right="Explorer"
            rightColor={color.lime}
            onPress={() => Linking.openURL(`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`)}
          />
          <Row title="pUSD (test dollars)" meta={short(USD_MINT.toBase58())} onPress={() => copy(USD_MINT.toBase58(), "pUSD mint")} />
          <Row title="SKR (devnet stand-in)" meta={short(SKR_MINT.toBase58())} onPress={() => copy(SKR_MINT.toBase58(), "SKR mint")} />
        </Card>
      ) : null}

      <SectionTitle title="About" />
      <Card>
        <Text size={14} color={color.muted} style={{ lineHeight: 20 }}>
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
        <Text size={13} color={color.muted} style={{ textAlign: "center", marginTop: 8 }}>
          The guest key stays on this phone, so reconnecting brings the same account back.
        </Text>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  qr: { backgroundColor: "#fff", padding: 8, borderRadius: 14 },
  addr: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", backgroundColor: color.surface2, paddingHorizontal: 12, minHeight: 36, borderRadius: radius.pill },
  divider: { height: 1, backgroundColor: color.hairline },
  advancedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 8, minHeight: 44 },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    paddingHorizontal: 18,
    color: color.text,
    fontFamily: font.regular,
    fontSize: 15,
  },
});
