import React, { useEffect, useRef, useState } from "react";
import { FlatList, Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, Text } from "../src/ui/kit";
import { Coins } from "../src/ui/Art";
import { color } from "../src/ui/theme";
import { explainError, useWallet } from "../src/wallet/WalletProvider";
import { CLUSTER } from "../src/lib/config";
import { useToast } from "../src/ui/Toast";

const PAGES = [
  { title: "Pay now,\nor in four.", body: "Pay a shop in dollars, or split it into four with nothing due today. The shop is paid in full either way." },
  { title: "Clock in daily.\nGrow your line.", body: "Check in once a day for SKR and a point on your score. Pay on time and your Pay in 4 limit climbs." },
  { title: "Send dollars\nby link.", body: "Share a link. Whoever opens it gets the dollars, with no fees and no wallet needed to claim." },
];

export default function Onboarding() {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const list = useRef<FlatList>(null);
  const router = useRouter();
  const { connectMwa, useGuest, mwaAvailable } = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState<"mwa" | "guest" | null>(null);
  const last = page === PAGES.length - 1;
  // Lets the screenshot script turn pages (polaris://onboarding?page=2 works too).
  const params = useLocalSearchParams<{ page?: string }>();
  useEffect(() => {
    const p = Number(params.page);
    if (p >= 0 && p < PAGES.length) {
      list.current?.scrollToIndex({ index: p, animated: false });
      setPage(p);
    }
  }, [params.page]);

  async function go(kind: "mwa" | "guest") {
    setBusy(kind);
    try {
      if (kind === "mwa") await connectMwa();
      else await useGuest();
      router.replace("/(tabs)");
    } catch (e) {
      toast({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Image source={require("../assets/wordmark.png")} style={{ width: 92, height: 28 }} resizeMode="contain" />
        <View style={s.net}>
          <View style={s.dot} />
          <Text size={13} weight="medium" color={color.muted}>
            Solana {CLUSTER}
          </Text>
        </View>
      </View>
      <FlatList
        ref={list}
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          <View style={{ width, paddingHorizontal: 24 }}>
            <View style={{ alignItems: "center", marginTop: 12 }}>
              <Coins size={Math.min(width - 48, 340)} variant={index} />
            </View>
            <Text weight="bold" size={36} style={{ marginTop: 8, lineHeight: 40 }}>
              {item.title}
            </Text>
            <Text size={15} color={color.muted} style={{ marginTop: 12, lineHeight: 21 }}>
              {item.body}
            </Text>
          </View>
        )}
      />
      <View style={s.dots}>
        {PAGES.map((_, i) => (
          <View key={i} style={[s.pageDot, i === page && { width: 22, backgroundColor: color.text }]} />
        ))}
      </View>
      <View style={{ paddingHorizontal: 24, gap: 10, paddingBottom: 8 }}>
        {!last ? (
          <Button
            title="Next"
            kind="white"
            onPress={() => {
              list.current?.scrollToIndex({ index: page + 1 });
              setPage(page + 1);
            }}
          />
        ) : (
          <>
            {mwaAvailable ? (
              <Button
                testID="connect-mwa"
                title="Connect wallet"
                kind="lime"
                loading={busy === "mwa"}
                icon={<Ionicons name="wallet" size={18} color={color.onLime} />}
                onPress={() => go("mwa")}
              />
            ) : null}
            <Button
              testID="guest"
              title={mwaAvailable ? "Try with a guest wallet" : "Continue with a guest wallet"}
              kind={mwaAvailable ? "ink" : "lime"}
              loading={busy === "guest"}
              onPress={() => go("guest")}
            />
            <Text size={13} color={color.muted} style={{ textAlign: "center", marginTop: 2 }}>
              {mwaAvailable
                ? "Seed Vault, Phantom or Solflare via Mobile Wallet Adapter. Guest wallets live on this phone, devnet only."
                : Platform.OS === "ios"
                  ? "Mobile Wallet Adapter is Android-only. The guest wallet is a devnet-only key kept on this device."
                  : "The guest wallet is a devnet-only key kept on this device."}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 24, paddingTop: 8 },
  net: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: color.surface1, paddingHorizontal: 10, height: 28, borderRadius: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.lime },
  dots: { flexDirection: "row", gap: 6, paddingHorizontal: 24, marginBottom: 20 },
  pageDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.dim },
});
