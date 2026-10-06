import React, { useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { Button, Card, Text } from "../src/ui/kit";
import { color, font, gutter, radius } from "../src/ui/theme";
import { useAccount } from "../src/state/AccountProvider";
import { useAction } from "../src/state/useAction";
import { useWallet } from "../src/wallet/WalletProvider";
import { ix } from "../src/chain/polaris";
import { fmtUsd, ONE } from "../src/lib/credit";
import { useToast } from "../src/ui/Toast";

// Covers the claim's fee and the recipient's token-account rent, so the
// person who opens the link needs no SOL.
const LINK_KEY_LAMPORTS = 2_100_000;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

export default function Send() {
  const router = useRouter();
  const a = useAccount();
  const { publicKey } = useWallet();
  const { run, busy } = useAction();
  const toast = useToast();
  const [text, setText] = useState("");
  const [link, setLink] = useState<{ url: string; amount: number } | null>(null);
  const amount = Math.round(Number(text || "0") * ONE);
  const over = amount > a.usd;

  function press(k: string) {
    Haptics.selectionAsync().catch(() => {});
    if (k === "del") return setText((t) => t.slice(0, -1));
    if (k === "." && text.includes(".")) return;
    if (text.includes(".") && text.split(".")[1].length >= 2) return;
    if (text.replace(".", "").length >= 6) return;
    setText((t) => (t === "0" && k !== "." ? k : t + k));
  }

  async function create() {
    const key = Keypair.generate();
    const sig = await run(
      "link",
      async () => [
        ix.fundLinkKey(publicKey!, key.publicKey, LINK_KEY_LAMPORTS),
        await ix.createLink(publicKey!, key.publicKey, amount, 14 * 86_400),
      ],
      `Link ready: ${fmtUsd(amount)}`,
    );
    if (sig) setLink({ url: `polaris://claim?k=${bs58.encode(key.secretKey)}`, amount });
  }

  if (link) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.grabber} />
        <View style={s.top}>
          <View style={{ width: 24 }} />
          <Text weight="bold" size={17}>
            Send by link
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="close" size={24} color={color.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: "center", padding: gutter }}>
          <Text weight="bold" size={44} style={{ marginTop: 8 }}>
            {fmtUsd(link.amount)}
          </Text>
          <Text size={13} color={color.muted} style={{ textAlign: "center", marginTop: 6 }}>
            Whoever opens this link gets the dollars, with no fees. Valid 14 days; you can take it back until it's claimed.
          </Text>
          <View style={s.qr}>
            <QRCode value={link.url} size={200} color="#0f1011" backgroundColor="#ffffff" />
          </View>
          <Card style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text size={12} color={color.muted} numberOfLines={1} style={{ flex: 1 }}>
              {link.url}
            </Text>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(link.url);
                toast({ kind: "ok", text: "Link copied" });
              }}
              style={s.copy}
            >
              <Ionicons name="copy" size={16} color={color.onLime} />
            </Pressable>
          </Card>
          <Text size={11} color={color.dim} style={{ textAlign: "center", marginTop: 8 }}>
            The link holds the key to the money. Share it only with the person it's for.
          </Text>
        </View>
        <View style={{ padding: gutter, gap: 10 }}>
          <Button
            testID="share-link"
            title="Share"
            kind="white"
            icon={<Ionicons name="share-outline" size={18} color={color.onLime} />}
            onPress={() => Share.share({ message: `I sent you ${fmtUsd(link.amount)} with Polaris. Open to claim: ${link.url}` })}
          />
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
        <Text weight="bold" size={17}>
          Send
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={{ paddingHorizontal: gutter }}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={s.linkIcon}>
            <Ionicons name="link" size={18} color={color.onLime} />
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="medium">Anyone with the link</Text>
            <Text size={12} color={color.muted}>
              They claim it in Polaris, no SOL needed
            </Text>
          </View>
        </Card>
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: font.bold, fontSize: 60, letterSpacing: -3, color: over ? color.down : text ? color.text : color.dim }}>
          ${text || "0"}
        </Text>
        <Text size={13} color={color.muted}>
          Available {fmtUsd(a.usd)}
        </Text>
      </View>
      <View style={{ paddingHorizontal: gutter }}>
        <Button testID="create-link" title="Create link" disabled={!amount || over} loading={busy === "link"} onPress={create} />
        <View style={s.pad}>
          {KEYS.map((k) => (
            <Pressable
              key={k}
              testID={`key-${k}`}
              onPress={() => press(k)}
              style={({ pressed }) => [s.key, k === "del" && { backgroundColor: color.purple }, pressed && { opacity: 0.6 }]}
            >
              {k === "del" ? (
                <Ionicons name="backspace-outline" size={22} color="#fff" />
              ) : (
                <Text weight="medium" size={24}>
                  {k}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: color.surface3, marginTop: 8 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: gutter, paddingVertical: 10 },
  linkIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.lime, alignItems: "center", justifyContent: "center" },
  pad: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12, marginBottom: 12 },
  key: { width: "31.8%", height: 54, borderRadius: radius.key, backgroundColor: color.surface1, alignItems: "center", justifyContent: "center" },
  qr: { backgroundColor: "#fff", padding: 14, borderRadius: 20, marginVertical: 20 },
  copy: { width: 34, height: 34, borderRadius: 17, backgroundColor: color.lime, alignItems: "center", justifyContent: "center" },
});
