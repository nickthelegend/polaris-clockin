import { Redirect } from "expo-router";
import { View } from "react-native";
import { useWallet } from "../src/wallet/WalletProvider";
import { color } from "../src/ui/theme";

export default function Index() {
  const { ready, publicKey } = useWallet();
  if (!ready) return <View style={{ flex: 1, backgroundColor: color.canvas }} />;
  return <Redirect href={publicKey ? "/(tabs)" : "/onboarding"} />;
}
