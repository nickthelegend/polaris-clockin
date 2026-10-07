// Shared state between the autopilot (screenshot script) and the screens.
// Inert unless the bundle was built with EXPO_PUBLIC_AUTOPILOT=1.
export const AUTOPILOT = process.env.EXPO_PUBLIC_AUTOPILOT === "1";
export const bus: { lastLink?: string; simulateOffline?: boolean } = {};
