import React, { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WalletProvider } from "../src/wallet/WalletProvider";
import { AccountProvider } from "../src/state/AccountProvider";
import { ToastProvider } from "../src/ui/Toast";
import { color } from "../src/ui/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded] = useFonts({
    "Satoshi-Regular": require("../assets/fonts/Satoshi-Regular.ttf"),
    "Satoshi-Medium": require("../assets/fonts/Satoshi-Medium.ttf"),
    "Satoshi-Bold": require("../assets/fonts/Satoshi-Bold.ttf"),
    "Satoshi-Black": require("../assets/fonts/Satoshi-Black.ttf"),
  });
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: color.canvas }} />;

  return (
    <SafeAreaProvider>
      <WalletProvider>
        <AccountProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.canvas },
                animation: "slide_from_right",
              }}
            >
              <Stack.Screen name="index" options={{ animation: "none" }} />
              <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
              <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
              <Stack.Screen name="checkout" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="send" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="claim" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="plan" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
              <Stack.Screen name="skr" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
            </Stack>
          </ToastProvider>
        </AccountProvider>
      </WalletProvider>
    </SafeAreaProvider>
  );
}
