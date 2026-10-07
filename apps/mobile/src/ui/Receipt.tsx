import React, { useEffect, useRef } from "react";
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./kit";
import { color, gutter, radius } from "./theme";
import { explorerTx } from "../lib/config";

export type ReceiptRow = { k: string; v: string; tone?: string };

/** The success screen body: a check that settles in, the headline, and a receipt card. */
export function Receipt({
  headline,
  body,
  amount,
  rows,
  sig,
  next,
}: {
  headline: string;
  body: string;
  amount?: string;
  rows: ReceiptRow[];
  sig: string;
  next?: { title: string; rows: ReceiptRow[] };
}) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pop, { toValue: 1, duration: 420, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }).start();
  }, [pop]);
  return (
    <ScrollView contentContainerStyle={{ padding: gutter, paddingTop: 32, gap: 14 }}>
      <View style={{ alignItems: "center" }}>
        <Animated.View
          style={[
            s.check,
            { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] },
          ]}
        >
          <Ionicons name="checkmark" size={42} color={color.onLime} />
        </Animated.View>
        <Text weight="bold" size={32} style={{ marginTop: 16 }} accessibilityRole="header">
          {headline}
        </Text>
        {amount ? (
          <Text weight="bold" size={22} color={color.lime} style={{ marginTop: 4 }}>
            {amount}
          </Text>
        ) : null}
        <Text size={15} color={color.muted} style={{ textAlign: "center", marginTop: 8, lineHeight: 21, maxWidth: 340 }}>
          {body}
        </Text>
      </View>
      <View style={s.card}>
        {rows.map((r) => (
          <View key={r.k} style={s.row}>
            <Text size={14} color={color.muted}>
              {r.k}
            </Text>
            <Text size={14} weight="medium" color={r.tone ?? color.text} style={{ flexShrink: 1, textAlign: "right" }}>
              {r.v}
            </Text>
          </View>
        ))}
        <View style={s.perf} />
        <Pressable
          onPress={() => Linking.openURL(explorerTx(sig))}
          style={s.explorer}
          accessibilityRole="link"
          accessibilityLabel="Open the transaction on Solana Explorer"
        >
          <Ionicons name="open-outline" size={16} color={color.lime} />
          <Text size={14} weight="bold" color={color.lime} style={{ flex: 1 }}>
            View on Solana Explorer
          </Text>
          <Text size={13} color={color.muted}>
            {sig.slice(0, 6)}…{sig.slice(-4)}
          </Text>
        </Pressable>
      </View>
      {next ? (
        <View style={s.card}>
          <Text weight="bold" size={16} style={{ marginBottom: 4 }}>
            {next.title}
          </Text>
          {next.rows.map((r) => (
            <View key={r.k} style={s.row}>
              <Text size={14} color={color.muted}>
                {r.k}
              </Text>
              <Text size={14} weight="medium" color={r.tone ?? color.text}>
                {r.v}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  check: { width: 80, height: 80, borderRadius: 40, backgroundColor: color.lime, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: color.surface1, borderRadius: radius.surface, padding: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 9 },
  perf: { height: 1, borderTopWidth: 1, borderColor: color.hairlineStrong, borderStyle: "dashed", marginVertical: 8 },
  explorer: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
});
