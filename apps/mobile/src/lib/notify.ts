// Local notifications for the daily loop, all on the device (no push server):
//  - "clock-in": tomorrow at 9:00, after you clock in today
//  - "streak-risk": today at 20:00, only while you have a streak and haven't
//    clocked in yet; cancelled the moment you do
//  - "due-*": the day before each instalment
// Each kind can be switched off in Me; preferences live in AsyncStorage.
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { AUTOPILOT } from "../dev/bus";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type ReminderPrefs = { morning: boolean; streakRisk: boolean; dueDates: boolean };
const PREFS_KEY = "polaris.reminders.v1";
const DEFAULT_PREFS: ReminderPrefs = { morning: true, streakRisk: true, dueDates: true };

export async function getPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
export async function setPrefs(p: ReminderPrefs) {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

let granted: boolean | null = null;
/** Asks only when `ask` is true (a moment the user chose, e.g. after clocking in). */
export async function ensurePermission(ask = true): Promise<boolean> {
  if (AUTOPILOT) return false; // never block the scripted screenshots with a system prompt
  if (granted) return true;
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("daily", {
        name: "Daily clock-in",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#9cef5e",
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return (granted = true);
    if (!ask) return false;
    granted = (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    granted = false;
  }
  return !!granted;
}

async function at(id: string, date: Date, title: string, body: string) {
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (date.getTime() < Date.now() + 60_000) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: "daily" },
  });
}

/**
 * Brings the clock-in reminders in line with today's state. Never prompts
 * for permission unless `ask` (the user just clocked in or turned a toggle on).
 */
export async function syncDailyReminders(state: {
  checkedInToday: boolean;
  streak: number;
  nextRewardSkr: number;
  ask?: boolean;
}) {
  if (!(await ensurePermission(!!state.ask))) return;
  const prefs = await getPrefs();
  const now = new Date();

  if (prefs.morning) {
    const morning = new Date(now);
    if (state.checkedInToday || now.getHours() >= 9) morning.setDate(morning.getDate() + 1);
    morning.setHours(9, 0, 0, 0);
    await at(
      "clock-in",
      morning,
      state.streak > 1 ? `Keep your ${state.streak}-day streak` : "Clock in with Polaris",
      `Clock in for ${state.nextRewardSkr} SKR and a point on your score.`,
    );
  } else await Notifications.cancelScheduledNotificationAsync("clock-in").catch(() => {});

  const evening = new Date(now);
  evening.setHours(20, 0, 0, 0);
  if (prefs.streakRisk && !state.checkedInToday && state.streak > 0) {
    await at(
      "streak-risk",
      evening,
      `Your ${state.streak}-day streak ends at midnight`,
      `One tap keeps it alive and pays ${state.nextRewardSkr} SKR.`,
    );
  } else await Notifications.cancelScheduledNotificationAsync("streak-risk").catch(() => {});
}

/** Kept for the clock-in action: asks for permission at a moment the user chose. */
export async function scheduleClockInReminder(streak: number, nextRewardSkr: number) {
  await syncDailyReminders({ checkedInToday: true, streak, nextRewardSkr, ask: true });
}

export async function scheduleDueReminder(merchant: string, amount: string, dueAtSecs: number) {
  if (!(await ensurePermission(false))) return; // no prompt in the middle of a checkout
  if (!(await getPrefs()).dueDates) return;
  await at(
    `due-${dueAtSecs}`,
    new Date(dueAtSecs * 1000 - 86_400_000),
    `${merchant}: ${amount} due tomorrow`,
    "Pay early and it counts as on time: +12 on your score.",
  );
}

export async function cancelDueReminders() {
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of all) if (n.identifier.startsWith("due-")) await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
