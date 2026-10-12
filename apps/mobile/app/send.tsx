import React, { useEffect, useRef, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";


import { Button, Card, Text } from "../src/ui/kit";
import { color, font, gutter, radius } from "../src/ui/theme";
import { useAccount } from "../src/state/AccountProvider";
import { useAction } from "../src/state/useAction";
import { useWallet } from "../src/wallet/WalletProvider";
import { ix } from "../src/chain/polaris";
import { preparePendingLink, recoverPendingLink, savePendingLinkSignature, discardUnbroadcastLink } from '../src/lib/nativePendingLink';
import { fmtUsd, ONE } from "../src/lib/credit";
import { useToast } from "../src/ui/Toast";
import { AUTOPILOT, bus } from "../src/dev/autopilot";

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
  const [link, setLink] = useState<{ url: string; amount: number; expiresAt: number } | null>(null);
  const [recovery, setRecovery] = useState<'checking' | 'none' | 'retained'>('checking');
  const [recoveryMessage, setRecoveryMessage] = useState('Checking this device’s saved link…');
  const creating = useRef(false);
  const activeOwner = useRef(publicKey?.toBase58());
  activeOwner.current = publicKey?.toBase58();
  async function checkOriginal() {
    const owner = publicKey;
    if (!owner) { setLink(null); setRecovery('retained'); setRecoveryMessage('Connect the original wallet to review a saved link.'); return; }
    setRecovery('checking');
    try {
      const result = await recoverPendingLink(owner);
      if (activeOwner.current !== owner.toBase58()) return;
      if (result.kind === 'ready') { setLink(result); setRecovery('retained'); setRecoveryMessage('Matching link and original receipt verified finalized.'); }
      else { setLink(null); setRecovery(result.kind === 'none' ? 'none' : 'retained'); setRecoveryMessage(result.message); }
    } catch (error) {
      if (activeOwner.current !== owner.toBase58()) return;
      setLink(null); setRecovery('retained'); setRecoveryMessage('Saved link outcome is unavailable. ' + String((error as Error)?.message ?? 'Review the original receipt.'));
    }
  }
  useEffect(() => { setLink(null); void checkOriginal(); }, [publicKey?.toBase58()]);
  async function shareVerified(copy: boolean) {
    if (!publicKey) return;
    try {
      const result = await recoverPendingLink(publicKey);
      if (result.kind !== 'ready') { setLink(null); setRecovery('retained'); setRecoveryMessage(result.message); return; }
      if (copy) { await Clipboard.setStringAsync(result.url); toast({kind:'ok',text:'Link copied'}); }
      else await Share.share({message:`I sent you ${fmtUsd(result.amount)} with Polaris. Open to claim: ${result.url}`});
    } catch { toast({kind:'error',text:'Current finalized link state is unavailable. Nothing was shared.'}); }
  }
  const params = useLocalSearchParams<{ amount?: string; auto?: string }>();
  const amount = Math.round(Number(text || "0") * ONE);
  const autoRan = useRef(false);
  useEffect(() => {
    if (AUTOPILOT && params.amount && !autoRan.current) {
      autoRan.current = true;
      setText(params.amount);
    }
  }, [params.amount]);
  useEffect(() => {
    if (AUTOPILOT && params.auto === "1" && text && amount > 0 && !link && busy !== "link" && autoRan.current && !(bus as any).sent) {
      (bus as any).sent = true;
      create();
    }
  });
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
    if (!publicKey || creating.current || recovery !== 'none' || a.error || !amount || over) return;
    creating.current = true;
    const owner = publicKey;
    try {
      const key = await preparePendingLink(owner,amount);
      setRecovery('retained');
      setRecoveryMessage('Link secret retained securely. Waiting for the original transaction receipt.');
      if (activeOwner.current !== owner.toBase58()) { await discardUnbroadcastLink(owner,key); return; }
      await run('link', async () => [
        ix.fundLinkKey(owner,key,LINK_KEY_LAMPORTS),
        await ix.createLink(owner,key,amount,14*86400),
      ], 'Link transaction submitted', {
        quiet:true,
        onSignature:signature=>savePendingLinkSignature(owner,signature),
        onNoBroadcast:()=>discardUnbroadcastLink(owner,key),
      });
    } catch (error) { toast({kind:'error',text:String((error as Error)?.message ?? 'Link preparation failed.')}); }
    finally { creating.current=false; await checkOriginal(); }
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
            Whoever holds this link can claim its dollars until {new Date(link.expiresAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
          </Text>
          <View style={s.qr}>
            <QRCode value={link.url} size={200} color="#0f1011" backgroundColor="#ffffff" />
          </View>
          <Card style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text size={13} color={color.muted} numberOfLines={1} style={{ flex: 1 }}>
              {link.url}
            </Text>
            <Pressable
              onPress={() => shareVerified(true)}
              style={s.copy}
            >
              <Ionicons name="copy" size={16} color={color.onLime} />
            </Pressable>
          </Card>
          <Text size={13} color={color.muted} style={{ textAlign: "center", marginTop: 8 }}>
            The link holds the key to the money. Share it only with the person it's for.
          </Text>
        </View>
        <View style={{ padding: gutter, gap: 10 }}>
          <Button
            testID="share-link"
            title="Share"
            kind="white"
            icon={<Ionicons name="share-outline" size={18} color={color.onLime} />}
            onPress={() => shareVerified(false)}
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
            <Text size={13} color={color.muted}>
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
          {a.error ? 'Current balance unavailable' : `Available ${fmtUsd(a.usd)}`}
        </Text>
      </View>
      <View style={{ paddingHorizontal: gutter }}>
        {recovery !== 'none' ? <Card style={{gap:8,marginBottom:12}}>
          <Text size={13} color={color.muted}>{recoveryMessage}</Text>
          <Button title="Check original receipt" kind="white" loading={recovery === 'checking'} onPress={checkOriginal} />
        </Card> : null}
        <Button
          testID="create-link"
          title={amount ? `Create a ${fmtUsd(amount)} link` : "Create link"}
          disabled={!publicKey || !amount || over || !!a.error || recovery !== 'none'}
          hint={over ? `That's more than your ${fmtUsd(a.usd)}.` : "Type an amount on the keypad."}
          loading={busy === "link"}
          onPress={create}
        />
        <View style={s.pad}>
          {KEYS.map((k) => (
            <Pressable
              key={k}
              testID={`key-${k}`}
              accessibilityRole="button"
              accessibilityLabel={k === "del" ? "Delete" : k === "." ? "Decimal point" : k}
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
