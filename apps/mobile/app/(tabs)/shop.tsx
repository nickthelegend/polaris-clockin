import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, Screen, Tag, Text } from "../../src/ui/kit";
import { color, radius } from "../../src/ui/theme";
import { SHOPS } from "../../src/lib/catalog";
import { CLUSTER, MERCHANTS } from "../../src/lib/config";
import { useAccount } from "../../src/state/AccountProvider";
import { fmtUsd, ONE } from "../../src/lib/credit";

export default function Shop() {
  const router = useRouter();
  const { available } = useAccount();
  return (
    <Screen title="Shop" subtitle={`Merchants on Solana ${CLUSTER}. Pay now, or Pay in 4 with ${fmtUsd(available, 0)} available.`}>
        {SHOPS.filter((sh) => MERCHANTS[sh.slug]).map((sh) => (
          <Card key={sh.slug} style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
            <View style={s.shopHead}>
              <View style={[s.logo, { backgroundColor: sh.tint }]}>
                <Ionicons name={sh.icon as any} size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text weight="bold" size={16}>
                    {MERCHANTS[sh.slug].name}
                  </Text>
                  <Ionicons name="checkmark-circle" size={14} color={color.lime} />
                </View>
                <Text size={13} color={color.muted}>
                  {sh.tagline}
                </Text>
              </View>
            </View>
            {sh.items.map((it) => {
              const p4 = it.price * ONE <= available && it.price >= 1;
              return (
                <Pressable
                  key={it.id}
                  testID={`item-${sh.slug}-${it.id}`}
                  onPress={() => router.push({ pathname: "/checkout", params: { shop: sh.slug, item: it.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.title}, ${fmtUsd(it.price * ONE)}${p4 ? ", Pay in 4 available" : ""}`}
                  style={({ pressed }) => [s.item, pressed && { backgroundColor: color.surface2 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text weight="medium">{it.title}</Text>
                    <Text size={13} color={color.muted} style={{ marginTop: 2 }}>
                      {it.note}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text weight="bold">{fmtUsd(it.price * ONE)}</Text>
                    {p4 ? <Tag tone="purple" label={`4 × ${fmtUsd((it.price * ONE) / 4)}`} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  shopHead: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: color.hairline },
  logo: { width: 42, height: 42, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  item: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12, minHeight: 64 },
});
