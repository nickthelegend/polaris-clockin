// Local notifications for the daily loop: a "clock in" nudge for tomorrow
// morning, and a reminder the day before each instalment is due. All local,
// no push server.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { AUTOPILOT } from "../dev/autopilot";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let granted: boolean | null = null;
/** Asks only when `ask` is true (a moment the user chose, e.g. after clocking in). */
export async function ensurePermission(ask = true): Promise<boolean> {
  if (AUTOPILOT) return false; // never block the scripted screenshots with a system prompt
  if (granted !== null) return granted;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("daily", {
        name: "Daily clock-in",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#9cef5e",
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted && !ask) return false;
    granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    granted = false;
  }
  return granted;
}

export async function scheduleClockInReminder(streak: number, nextRewardSkr: number) {
  if (!(await ensurePermission())) return;
  await Notifications.cancelScheduledNotificationAsync("clock-in").catch(() => {});
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(9, 0, 0, 0);
  await Notifications.scheduleNotificationAsync({
    identifier: "clock-in",
    content: {
      title: streak > 1 ? `Keep your ${streak}-day streak` : "Clock in with Polaris",
      body: `Clock in today for ${nextRewardSkr} SKR and a point on your score.`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: "daily" },
  });
}

export async function scheduleDueReminder(merchant: string, amount: string, dueAtSecs: number) {
  if (!(await ensurePermission(false))) return; // no prompt in the middle of a checkout
  const at = new Date(dueAtSecs * 1000 - 86_400_000);
  if (at.getTime() < Date.now() + 60_000) return;
  await Notifications.scheduleNotificationAsync({
    identifier: `due-${dueAtSecs}`,
    content: { title: `${merchant}: ${amount} due tomorrow`, body: "Pay early and it counts as on time: +12 on your score." },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: "daily" },
  });
}
