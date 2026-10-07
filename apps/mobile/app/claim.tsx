import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { Button, Card, Money, Text } from "../src/ui/kit";
import { Coins } from "../src/ui/Art";
import { Receipt } from "../src/ui/Receipt";
import { color, gutter, radius } from "../src/ui/theme";
import { claimWithLinkKey, fetchLink } from "../src/chain/polaris";
import { explainError, useWallet } from "../src/wallet/WalletProvider";
import { useAccount } from "../src/state/AccountProvider";
import { CLUSTER } from "../src/lib/config";
import { ONE } from "../src/lib/credit";
import { useToast } from "../src/ui/Toast";
import { AUTOPILOT } from "../src/dev/autopilot";

export default function Claim() {
  const { k, auto } = useLocalSearchParams<{ k: string; auto?: string }>();
  const router = useRouter();
  const { publicKey, useGuest } = useWallet();
  const { refresh } = useAccount();
  const toast = useToast();
  const key = useMemo(() => {
    try {
      return Keypair.fromSecretKey(bs58.decode(k ?? ""));
    } catch {
      return null;
    }
  }, [k]);
  const [link, setLink] = useState<{ amount: number; sender: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return setLink(null);
    fetchLink(key.publicKey)
      .then((l) => setLink(l ? { amount: l.amount.toNumber(), sender: l.sender.toBase58() } : null))
      .catch(() => setLink(null));
  }, [key]);

  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (AUTOPILOT && auto === "1" && link && !autoRan && !done) {
      setAutoRan(true);
      claim();
    }
  });

  async function claim() {
    if (!key) return;
    setBusy(true);
    try {
      let to = publicKey;
      if (!to) {
        await useGuest();
        return; // the wallet change re-renders this screen with a key
      }
      const r = await claimWithLinkKey(key, to);
      setDone(r.sig);
      toast({ kind: "ok", text: `Claimed $${(r.amount / ONE).toFixed(2)}`, sig: r.sig });
      refresh();
    } catch (e) {
      toast({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.top}>
        <Pressable onPress={() => router.replace("/")} hitSlop={10}>
          <Ionicons name="close" size={24} color={color.text} />
        </Pressable>
        <Text weight="bold" size={17}>
          Claim
        </Text>
        <View style={{ width: 24 }} />
      </View>
      {done && link ? (
        <View style={{ flex: 1 }}>
          <Receipt
            headline="It's yours."
            amount={`$${(link.amount / ONE).toFixed(2)}`}
            body="The dollars are in your Polaris dollar account. The link paid its own network fee."
            rows={[
              { k: "From", v: `${link.sender.slice(0, 4)}…${link.sender.slice(-4)}` },
              { k: "To", v: publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : "you" },
              { k: "Fee you paid", v: "$0.00", tone: color.lime },
              { k: "Network", v: `Solana ${CLUSTER}` },
            ]}
            sig={done}
          />
        </View>
      ) : (
        <View style={{ padding: gutter, flex: 1 }}>
        <View style={s.hero}>
          <View style={{ flex: 1 }}>
            <Text size={14} weight="medium" color={color.onLime}>
              {done ? "It's yours" : "You've got dollars"}
            </Text>
            {link ? <Money value={link.amount / ONE} size={42} color={color.onLime} /> : null}
            <Text size={13} color="rgba(15,16,17,0.65)">
              {link === undefined
                ? "Checking the link…"
                : link
                  ? `from ${link.sender.slice(0, 4)}…${link.sender.slice(-4)}`
                  : done
                    ? "Landed in your dollar account"
                    : "This link was already claimed or taken back."}
            </Text>
          </View>
          <View style={{ marginRight: -20 }}>
            <Coins size={120} variant={1} />
          </View>
        </View>
        <Card style={{ marginTop: 12, gap: 14 }}>
          {[
            ["wallet", "Lands in your Polaris dollar account", publicKey ? `${publicKey.toBase58().slice(0, 4)}…` : "A guest wallet is made for you"],
            ["flash", "No fees to claim", "The link pays the network fee itself"],
            ["globe", "Dollars, wherever you are", "pUSD on Solana devnet (test money)"],
          ].map(([icon, t, m]) => (
            <View key={t} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Ionicons name={icon as any} size={18} color={color.muted} />
              <View>
                <Text weight="medium" size={14}>
                  {t}
                </Text>
                <Text size={13} color={color.muted}>
                  {m}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      </View>
      )}
      <View style={{ padding: gutter }}>
        {done ? (
          <Button testID="claim-done" title="Done" onPress={() => router.replace("/")} />
        ) : (
          <Button
            testID="claim"
            title={publicKey ? `Claim${link ? ` $${(link.amount / ONE).toFixed(2)}` : ""}` : "Create guest wallet to claim"}
            disabled={!link}
            loading={busy}
            onPress={claim}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: gutter, paddingVertical: 12 },
  hero: { backgroundColor: color.lime, borderRadius: radius.card, padding: 20, flexDirection: "row", alignItems: "center", overflow: "hidden" },
});
