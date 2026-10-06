import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./kit";
import { color } from "./theme";
import { explorerTx } from "../lib/config";

type Toast = { kind: "ok" | "error"; text: string; sig?: string };
const Ctx = createContext<(t: Toast) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (t: Toast) => {
      Haptics.notificationAsync(
        t.kind === "ok" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      ).catch(() => {});
      setToast(t);
      if (timer.current) clearTimeout(timer.current);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
      timer.current = setTimeout(
        () => Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null)),
        t.kind === "ok" ? 3500 : 6000,
      );
    },
    [anim],
  );

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            s.wrap,
            { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] },
          ]}
        >
          <Pressable
            onPress={() => toast.sig && Linking.openURL(explorerTx(toast.sig))}
            style={[s.toast, { borderColor: toast.kind === "ok" ? color.lime + "66" : color.down + "66" }]}
          >
            <Ionicons
              name={toast.kind === "ok" ? "checkmark-circle" : "alert-circle"}
              size={20}
              color={toast.kind === "ok" ? color.lime : color.down}
            />
            <View style={{ flex: 1 }}>
              <Text size={14} weight="medium">
                {toast.text}
              </Text>
              {toast.sig ? (
                <Text size={12} color={color.muted}>
                  {toast.sig.slice(0, 8)}… · view on Explorer
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1d1e21",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
});
