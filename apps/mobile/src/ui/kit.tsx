import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text as RNText,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { color, font, radius } from "./theme";

type Weight = "regular" | "medium" | "bold" | "black";

export function Text({
  weight = "regular",
  size = 15,
  color: c = color.text,
  style,
  ...rest
}: TextProps & { weight?: Weight; size?: number; color?: string }) {
  return (
    <RNText
      {...rest}
      style={[{ fontFamily: font[weight], fontSize: size, color: c, letterSpacing: size >= 28 ? -size * 0.04 : -0.2 }, style]}
    />
  );
}

export function Money({
  value,
  size = 44,
  color: c = color.text,
  prefix = "$",
  dimCents = true,
}: {
  value: number;
  size?: number;
  color?: string;
  prefix?: string;
  dimCents?: boolean;
}) {
  const [whole, cents] = value.toFixed(2).split(".");
  const w = Number(whole).toLocaleString("en-US");
  return (
    <RNText style={{ fontFamily: font.bold, fontSize: size, color: c, letterSpacing: -size * 0.05 }}>
      {prefix}
      {w}
      <RNText style={{ opacity: dimCents ? 0.45 : 1 }}>.{cents}</RNText>
    </RNText>
  );
}

export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type BtnKind = "lime" | "white" | "ink" | "purple" | "ghost";
export function Button({
  title,
  onPress,
  kind = "lime",
  loading,
  disabled,
  icon,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  kind?: BtnKind;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const bg = { lime: color.lime, white: "#ffffff", ink: color.surface3, purple: color.purple, ghost: "transparent" }[kind];
  const fg = kind === "lime" || kind === "white" ? color.onLime : color.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        kind === "ghost" && { borderWidth: 1, borderColor: color.hairlineStrong },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {icon}
          <Text weight="bold" size={16} color={fg}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.pill, { backgroundColor: active ? color.text : color.surface2 }]}
    >
      <Text weight="medium" size={13} color={active ? color.onLime : color.text}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Tag({ label, tone = "muted" }: { label: string; tone?: "muted" | "lime" | "purple" | "warn" | "down" }) {
  const c = { muted: color.muted, lime: color.lime, purple: color.purpleText, warn: color.warn, down: color.down }[tone];
  return (
    <View style={[s.tag, { borderColor: c + "55" }]}>
      <Text weight="medium" size={11} color={c}>
        {label}
      </Text>
    </View>
  );
}

export function Row({
  title,
  meta,
  right,
  rightMeta,
  icon,
  onPress,
  rightColor,
}: {
  title: string;
  meta?: string;
  right?: string;
  rightMeta?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  rightColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && onPress ? { opacity: 0.7 } : null]}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text weight="medium" size={15}>
          {title}
        </Text>
        {meta ? (
          <Text size={12} color={color.muted} style={{ marginTop: 2 }}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {right ? (
          <Text weight="medium" size={15} color={rightColor ?? color.text}>
            {right}
          </Text>
        ) : null}
        {rightMeta ? (
          <Text size={12} color={color.muted} style={{ marginTop: 2 }}>
            {rightMeta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Avatar({ label, bg }: { label: string; bg: string }) {
  return (
    <View style={[s.avatar, { backgroundColor: bg }]}>
      <Text weight="bold" size={15} color="#fff">
        {label}
      </Text>
    </View>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.stat}>
      <Text weight="bold" size={18} color={tone ?? color.text}>
        {value}
      </Text>
      <Text size={12} color={color.muted} style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.section}>
      <Text weight="bold" size={17}>
        {title}
      </Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text size={13} color={color.muted}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const textStyle = (size: number, weight: Weight = "regular", c: string = color.text): TextStyle => ({
  fontFamily: font[weight],
  fontSize: size,
  color: c,
});

const s = StyleSheet.create({
  card: { backgroundColor: color.surface1, borderRadius: radius.surface, padding: 16 },
  btn: { height: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  pill: { paddingHorizontal: 14, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  stat: { flex: 1, backgroundColor: color.surface1, borderRadius: radius.surface, padding: 14 },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 8 },
});
