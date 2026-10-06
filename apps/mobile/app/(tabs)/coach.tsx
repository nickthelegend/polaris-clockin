import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Card, Tag, Text } from "../../src/ui/kit";
import { color, font, gutter, radius } from "../../src/ui/theme";
import { useAccount } from "../../src/state/AccountProvider";
import { askCoach, coachMode, factsText, rulesSummary } from "../../src/lib/coach";
import { buildFacts } from "../../src/lib/facts";

type Msg = { role: "user" | "coach"; text: string; ai?: boolean };
const SUGGESTED = ["Why is my limit what it is?", "How do I reach the next tier fastest?", "Should I lock SKR or keep it?", "What happens if I pay late?"];

export default function Coach() {
  const a = useAccount();
  const router = useRouter();
  const [mode, setMode] = useState<"server" | "key" | "off">("off");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      coachMode().then(setMode);
    }, []),
  );
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [msgs]);

  const facts = buildFacts(a);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      if (mode === "off") {
        setMsgs((m) => [...m, { role: "coach", text: rulesSummary(facts).join("\n\n"), ai: false }]);
      } else {
        const text = await askCoach(q, facts);
        setMsgs((m) => [...m, { role: "coach", text, ai: true }]);
      }
    } catch (e: any) {
      setMsgs((m) => [
        ...m,
        { role: "coach", text: `${rulesSummary(facts).join("\n\n")}\n\n(AI unavailable: ${e?.message ?? e})`, ai: false },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.canvas }} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingHorizontal: gutter, paddingTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text weight="bold" size={30}>
              Coach
            </Text>
            <Tag
              label={mode === "off" ? "AI off · rules" : mode === "server" ? "Claude · server" : "Claude · your key"}
              tone={mode === "off" ? "muted" : "purple"}
            />
          </View>
          <Text size={13} color={color.muted} style={{ marginTop: 4 }}>
            Reads only your on-chain Polaris profile.{" "}
            <Text size={13} color={color.purpleText} onPress={() => setShowFacts((x) => !x)}>
              {showFacts ? "Hide" : "See"} what it sees
            </Text>
          </Text>
          {mode === "off" ? (
            <Pressable onPress={() => router.push("/(tabs)/me")}>
              <Text size={12} color={color.dim} style={{ marginTop: 4 }}>
                Add an Anthropic API key in Me to turn on Claude. Until then, answers come from fixed rules.
              </Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: gutter, paddingBottom: 24, gap: 10 }} keyboardShouldPersistTaps="handled">
          {showFacts ? (
            <Card>
              <Text size={12} color={color.muted} style={{ lineHeight: 18 }}>
                {factsText(facts)}
              </Text>
            </Card>
          ) : null}
          {msgs.length === 0 ? (
            <Card style={{ gap: 8 }}>
              <Ionicons name="sparkles" size={20} color={color.purpleText} />
              <Text weight="bold" size={17}>
                Score {a.score}. Limit {"$" + (a.limit / 1e6).toFixed(0)}.
              </Text>
              {rulesSummary(facts)
                .slice(0, 2)
                .map((t) => (
                  <Text key={t} size={13} color={color.muted} style={{ lineHeight: 19 }}>
                    {t}
                  </Text>
                ))}
            </Card>
          ) : null}
          {msgs.map((m, i) => (
            <View key={i} style={[s.bubble, m.role === "user" ? s.user : s.coach]}>
              <Text size={14} color={m.role === "user" ? color.onLime : color.text} style={{ lineHeight: 20 }}>
                {m.text}
              </Text>
              {m.role === "coach" ? (
                <Text size={10} color={color.dim} style={{ marginTop: 6 }}>
                  {m.ai ? "Claude" : "Rules-based (AI off)"}
                </Text>
              ) : null}
            </View>
          ))}
          {busy ? (
            <View style={[s.bubble, s.coach]}>
              <Text size={14} color={color.muted}>
                Thinking…
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={{ paddingHorizontal: gutter, paddingBottom: 96 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
            {SUGGESTED.map((q) => (
              <Pressable key={q} onPress={() => ask(q)} style={s.chip}>
                <Text size={13}>{q}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={s.inputRow}>
            <TextInput
              testID="coach-input"
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => ask(input)}
              placeholder="Ask about your credit…"
              placeholderTextColor={color.dim}
              style={s.input}
              returnKeyType="send"
            />
            <Pressable onPress={() => ask(input)} style={s.send}>
              <Ionicons name="arrow-up" size={20} color={color.onLime} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  bubble: { padding: 14, borderRadius: 18, maxWidth: "88%" },
  user: { alignSelf: "flex-end", backgroundColor: color.lime, borderBottomRightRadius: 6 },
  coach: { alignSelf: "flex-start", backgroundColor: color.surface1, borderBottomLeftRadius: 6 },
  chip: { backgroundColor: color.surface1, borderRadius: radius.pill, paddingHorizontal: 14, height: 34, justifyContent: "center" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: color.surface1,
    paddingHorizontal: 18,
    color: color.text,
    fontFamily: font.regular,
    fontSize: 15,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.lime, alignItems: "center", justifyContent: "center" },
});
