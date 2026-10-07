import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { color } from "../../src/ui/theme";
import { useWallet } from "../../src/wallet/WalletProvider";

const LABELS: Record<string, string> = { index: "Home", shop: "Shop", credit: "Credit", coach: "Coach", me: "Me" };
const ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  index: ["home", "home-outline"],
  shop: ["bag-handle", "bag-handle-outline"],
  credit: ["pulse", "pulse-outline"],
  coach: ["sparkles", "sparkles-outline"],
  me: ["person-circle", "person-circle-outline"],
};

function TabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 12) + 4;
  return (
    <>
    {/* Content scrolling under the floating bar fades out instead of colliding with it. */}
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(15,16,17,0)", "rgba(15,16,17,0.92)", "#0f1011"]}
      locations={[0, 0.55, 1]}
      style={[s.fade, { height: bottom + 90 }]}
    />
    <View pointerEvents="box-none" style={[s.wrap, { bottom }]}>
      <View style={s.bar}>
        {state.routes.map((route: any, i: number) => {
          const focused = state.index === i;
          const [on, off] = ICONS[route.name] ?? ["ellipse", "ellipse-outline"];
          return (
            <Pressable
              key={route.key}
              testID={`tab-${route.name}`}
              accessibilityRole="tab"
              accessibilityLabel={LABELS[route.name] ?? route.name}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                if (!focused) navigation.navigate(route.name);
              }}
              style={[s.tab, focused && s.active]}
            >
              <Ionicons name={focused ? on : off} size={21} color={focused ? color.onLime : "rgba(255,255,255,0.7)"} />
            </Pressable>
          );
        })}
      </View>
    </View>
    </>
  );
}

export default function TabsLayout() {
  const { ready, publicKey } = useWallet();
  if (ready && !publicKey) return <Redirect href="/onboarding" />;
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.canvas } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="shop" />
      <Tabs.Screen name="credit" />
      <Tabs.Screen name="coach" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(38,39,42,0.96)",
    borderRadius: 999,
    padding: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  tab: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: color.lime },
});
