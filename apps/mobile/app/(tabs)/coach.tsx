import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Card, ScreenHeader, StateBlock, Tag, Text, TAB_BAR_HEIGHT, useTabBarSpace } from "../../src/ui/kit";
import { color, font, gutter, radius } from "../../src/ui/theme";
import { useAccount } from "../../src/state/AccountProvider";
import { askCoach, coachMode, factsText, rulesSummary } from "../../src/lib/coach";
import { buildFacts } from "../../src/lib/facts";
import { fmtUsd, nextTier, ONE, tierOf } from "../../src/lib/credit";

type Msg = { role: "user" | "coach"; text: string; ai?: boolean };
const SUGGESTED = [
  { icon: "trending-up", q: "How do I reach the next tier fastest?" },
  { icon: "help-circle", q: "Why is my limit what it is?" },
  { icon: "lock-closed", q: "Should I lock SKR or keep it?" },
  { icon: "alert-circle", q: "What happens if I pay late?" },
] as const;

export default function Coach() {
  const a = useAccount();
  const router = useRouter();
  const [mode, setMode] = useState<"server" | "key" | "off">("off");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const bottom = useTabBarSpace();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const asked = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      coachMode().then(setMode);
    }, []),
  );
  useEffect(() => {
    if (q && asked.current !== q) {
      asked.current = q;
      ask(q);
    }
  }, [q]);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [msgs]);

  const facts = buildFacts(a);
  const tier = tierOf(a.score);
  const next = nextTier(a.score);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    Haptics.selectionAsync().catch(() => {});
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      if (mode === "off") {
        setMsgs((m) => [...m, { role: "coach", text: rulesSummary(facts).join("\n\n"), ai: false }]);
      } else {
        const text = await askCoach(question, facts);
        setMsgs((m) => [...m, { role: "coach", text, ai: true }]);
      }
    } catch (e: any) {
      setMsgs((m) => [
        ...m,
        { role: "coach", text: `${rulesSummary(facts).join("\n\n")}\n\n(Claude was unavailable, so this answer uses the rules.)`, ai: false },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 8, paddingBottom: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title="Coach"
            subtitle="Ask about your score, your limit or a purchase. Coach reads only your on-chain Polaris record."
            right={<Tag label={mode === "off" ? "Rules · AI off" : "Claude"} tone={mode === "off" ? "muted" : "purple"} />}
          />

          {/* Profile summary */}
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Mini label="Score" value={String(a.score)} />
              <Mini label="Your line" value={fmtUsd(tier.limit * ONE, 0)} />
              <Mini label="Limit with SKR" value={fmtUsd(a.limit, 0)} tone={color.lime} />
            </View>
            <View>
              <View style={s.track}>
                <View
                  style={[
                    s.fill,
                    { width: `${next ? Math.min(100, Math.max(6, ((a.score - tier.min) / (next.min - tier.min)) * 100)) : 100}%` },
                  ]}
                />
              </View>
              <Text size={14} color={color.muted} style={{ marginTop: 8 }}>
                {next ? `${next.min - a.score} points to ${next.band} (a $${next.limit} line)` : "Top band: keep paying on time to stay here"}
              </Text>
            </View>
            <Pressable onPress={() => setShowFacts((x) => !x)} hitSlop={8} accessibilityRole="button" style={{ minHeight: 32, justifyContent: "center" }}>
              <Text size={14} weight="medium" color={color.purpleText}>
                {showFacts ? "Hide what Coach sees" : "See exactly what Coach sees"}
              </Text>
            </Pressable>
            {showFacts ? (
              <Text size={13} color={color.muted} style={{ lineHeight: 19 }}>
                {factsText(facts)}
              </Text>
            ) : null}
          </Card>

          {msgs.length === 0 ? (
            <>
              <Text weight="bold" size={17} style={{ marginTop: 4 }}>
                Ask Coach
              </Text>
              <Card style={{ paddingVertical: 4 }}>
                {SUGGESTED.map((sq, i) => (
                  <Pressable
                    key={sq.q}
                    testID={`suggest-${i}`}
                    onPress={() => ask(sq.q)}
                    accessibilityRole="button"
                    style={({ pressed }) => [s.suggest, i > 0 && s.divider, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name={sq.icon as any} size={18} color={color.purpleText} />
                    <Text size={15} style={{ flex: 1 }}>
                      {sq.q}
                    </Text>
                    <Ionicons name="arrow-forward" size={16} color={color.dim} />
                  </Pressable>
                ))}
              </Card>
              {mode === "off" ? (
                <StateBlock
                  icon={<Ionicons name="sparkles-outline" size={20} color={color.purpleText} />}
                  title="Works without AI"
                  body="Without a key, Coach answers from the program's own rules: your next tier, what moves your score, whether a plan fits. Add your Anthropic key in Me to have Claude answer in plain words."
                  action="Add key"
                  onAction={() => router.push("/(tabs)/me")}
                />
              ) : null}
            </>
          ) : null}

          {msgs.map((m, i) => (
            <View key={i} style={[s.bubble, m.role === "user" ? s.user : s.coach]}>
              <Text size={15} color={m.role === "user" ? color.onLime : color.text} style={{ lineHeight: 21 }}>
                {m.text}
              </Text>
              {m.role === "coach" ? (
                <Text size={12} color={color.muted} style={{ marginTop: 8 }}>
                  {m.ai ? "Claude, from your on-chain profile" : "Rules-based answer (AI off)"}
                </Text>
              ) : null}
            </View>
          ))}
          {busy ? (
            <View style={[s.bubble, s.coach]}>
              <Text size={15} color={color.muted}>
                Thinking…
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={{ paddingHorizontal: gutter, paddingBottom: bottom - TAB_BAR_HEIGHT + 8, paddingTop: 8 }}>
          {msgs.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
              {SUGGESTED.map((sq) => (
                <Pressable key={sq.q} onPress={() => ask(sq.q)} style={s.chip} accessibilityRole="button">
                  <Text size={14}>{sq.q}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={s.inputRow}>
            <TextInput
              testID="coach-input"
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => ask(input)}
              placeholder="Ask about your credit…"
              placeholderTextColor={color.muted}
              style={s.input}
              returnKeyType="send"
              accessibilityLabel="Ask Coach"
            />
            <Pressable onPress={() => ask(input)} style={s.send} accessibilityRole="button" accessibilityLabel="Send question">
              <Ionicons name="arrow-up" size={22} color={color.onLime} />
            </Pressable>
          </View>
        </View>
        <View style={{ height: TAB_BAR_HEIGHT }} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text weight="bold" size={20} color={tone ?? color.text}>
        {value}
      </Text>
      <Text size={13} color={color.muted} style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  track: { height: 8, borderRadius: 4, backgroundColor: color.track, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: color.purple },
  suggest: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: color.hairline },
  bubble: { padding: 14, borderRadius: 18, maxWidth: "90%" },
  user: { alignSelf: "flex-end", backgroundColor: color.lime, borderBottomRightRadius: 6 },
  coach: { alignSelf: "flex-start", backgroundColor: color.surface1, borderBottomLeftRadius: 6 },
  chip: { backgroundColor: color.surface1, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: color.surface1,
    paddingHorizontal: 18,
    color: color.text,
    fontFamily: font.regular,
    fontSize: 16,
  },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: color.lime, alignItems: "center", justifyContent: "center" },
});
