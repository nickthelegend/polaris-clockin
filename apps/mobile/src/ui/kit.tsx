import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  ScrollViewProps,
  Switch,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, gutter, radius } from "./theme";

/** Room the floating tab bar takes at the bottom of a tab screen. */
export const TAB_BAR_HEIGHT = 58;
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + 4 + 28;
}

type Weight = "regular" | "medium" | "bold" | "black";

export function Text({
  weight = "regular",
  size = 15,
  color: c = color.text,
  style,
  ...rest
}: TextProps & { weight?: Weight; size?: number; color?: string }) {
  // Nothing below 12 pt: secondary text stays readable, and Dynamic Type
  // scales from there (big display numbers cap their growth).
  const sz = Math.max(size, 12);
  return (
    <RNText
      maxFontSizeMultiplier={sz >= 28 ? 1.25 : 1.8}
      {...rest}
      style={[{ fontFamily: font[weight], fontSize: sz, color: c, letterSpacing: sz >= 28 ? -sz * 0.04 : -0.2 }, style]}
    />
  );
}

/** Animates a number from its last value to the new one (skipped with Reduce Motion). */
export function useCountUp(target: number, ms = 650) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      const start = from.current;
      if (reduce || start === target) {
        from.current = target;
        setShown(target);
        return;
      }
      const t0 = Date.now();
      const tick = () => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 4); // strong ease-out
        setShown(start + (target - start) * eased);
        if (k < 1) raf = requestAnimationFrame(tick);
        else from.current = target;
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, ms]);
  return shown;
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
  const v = useCountUp(value);
  const [whole, cents] = v.toFixed(2).split(".");
  const w = Number(whole).toLocaleString("en-US");
  return (
    <RNText
      maxFontSizeMultiplier={1.2}
      accessibilityLabel={`${prefix}${value.toFixed(2)}`}
      style={{ fontFamily: font.bold, fontSize: size, color: c, letterSpacing: -size * 0.05, fontVariant: ["tabular-nums"] }}
    >
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
  hint,
}: {
  title: string;
  onPress?: () => void;
  kind?: BtnKind;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Shown under a disabled button: why it can't be pressed yet. */
  hint?: string;
}) {
  const off = !!disabled && !loading;
  const bg = off
    ? color.surface2
    : { lime: color.lime, white: "#ffffff", ink: color.surface3, purple: color.purple, ghost: "transparent" }[kind];
  const fg = off ? color.muted : kind === "lime" || kind === "white" ? color.onLime : color.text;
  const button = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      accessibilityHint={off ? hint : undefined}
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        (kind === "ghost" || off) && { borderWidth: 1, borderColor: off ? color.hairlineStrong : color.hairlineStrong },
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
  if (!off || !hint) return button;
  return (
    <View style={style ? { alignSelf: "stretch" } : undefined}>
      {button}
      <View style={s.hintRow}>
        <View style={s.hintDot} />
        <Text size={13} color={color.muted} style={{ flex: 1, lineHeight: 18 }}>
          {hint}
        </Text>
      </View>
    </View>
  );
}

export function Pill({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      hitSlop={4}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={[s.pill, { backgroundColor: active ? color.text : color.surface2 }]}
    >
      <Text weight="medium" size={14} color={active ? color.onLime : color.text}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A tab screen: safe area, a consistent large header, and room for the tab bar. */
export function Screen({
  title,
  subtitle,
  right,
  children,
  scrollProps,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scrollProps?: ScrollViewProps & { ref?: React.Ref<ScrollView> };
}) {
  const bottom = useTabBarSpace();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <ScrollView
        {...scrollProps}
        contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 8, paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={title} subtitle={subtitle} right={right} />
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
        <Text weight="bold" size={30} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? (
        <Text size={15} color={color.muted} style={{ marginTop: 2, lineHeight: 21 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  title,
  meta,
  value,
  onChange,
  testID,
}: {
  title: string;
  meta?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <View style={s.toggle}>
      <View style={{ flex: 1 }}>
        <Text weight="medium" size={15}>
          {title}
        </Text>
        {meta ? (
          <Text size={13} color={color.muted} style={{ marginTop: 2, lineHeight: 18 }}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={(v) => {
          Haptics.selectionAsync().catch(() => {});
          onChange(v);
        }}
        trackColor={{ false: color.surface3, true: color.lime }}
        thumbColor="#ffffff"
        ios_backgroundColor={color.surface3}
        accessibilityLabel={title}
      />
    </View>
  );
}

/** A friendly empty or error block: icon, one line of what happened, one action. */
export function StateBlock({
  icon,
  title,
  body,
  action,
  onAction,
  tone = "muted",
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  tone?: "muted" | "down" | "warn";
}) {
  const border = tone === "down" ? color.down + "55" : tone === "warn" ? color.warn + "55" : color.hairlineStrong;
  return (
    <View style={[s.state, { borderColor: border }]}>
      <View style={s.stateIcon}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="bold" size={15}>
          {title}
        </Text>
        {body ? (
          <Text size={13} color={color.muted} style={{ lineHeight: 18 }}>
            {body}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" style={s.stateAction}>
          <Text weight="bold" size={14} color={color.lime}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Tag({ label, tone = "muted" }: { label: string; tone?: "muted" | "lime" | "purple" | "warn" | "down" }) {
  const c = { muted: color.muted, lime: color.lime, purple: color.purpleText, warn: color.warn, down: color.down }[tone];
  return (
    <View style={[s.tag, { borderColor: c + "55" }]}>
      <Text weight="medium" size={12} color={c}>
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
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [s.row, pressed && onPress ? { opacity: 0.7 } : null]}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text weight="medium" size={15}>
          {title}
        </Text>
        {meta ? (
          <Text size={13} color={color.muted} style={{ marginTop: 2 }} numberOfLines={2}>
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
          <Text size={13} color={color.muted} style={{ marginTop: 2 }}>
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
      <Text size={13} color={color.muted} style={{ marginTop: 2 }}>
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
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text size={14} color={color.muted}>
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
  pill: { paddingHorizontal: 16, minHeight: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, minHeight: 56 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingHorizontal: 4 },
  hintDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.warn },
  toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 56 },
  state: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: radius.surface, padding: 14, backgroundColor: color.surface1 },
  stateIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surface2, alignItems: "center", justifyContent: "center" },
  stateAction: { minHeight: 44, justifyContent: "center", paddingLeft: 4 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  stat: { flex: 1, backgroundColor: color.surface1, borderRadius: radius.surface, padding: 14 },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 8 },
});
