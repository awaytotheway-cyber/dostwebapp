import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { loadReflectionTime, morningOf, nextOccurrence, type HmTime } from './intentions';

export const REFLECTION_OPENING =
  "I've been holding space through the day. Would you like to share what's staying with you?";

export const REFLECTION_FOLLOW_UP = 'Would you like to name two things to notice tomorrow?';

const CHANNEL_ID = 'dost';
const EVENING_NEXT_ID = 'dost-evening-next';
const EVENING_DAILY_ID = 'dost-evening-daily';
const MORNING_ID = 'dost-morning-noticings';

const EVENING_BODY = "A quiet moment, if you'd like it. — DOST";

type PendingScreen = 'Reflection';
let pendingScreen: PendingScreen | null = null;
const navListeners = new Set<(screen: PendingScreen) => void>();
let routingStarted = false;
let consumedLaunchResponse = false;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // Native module may be unavailable until a rebuild.
}

export function requestOpenReflection() {
  if (navListeners.size === 0) {
    pendingScreen = 'Reflection';
    return;
  }
  navListeners.forEach((listener) => listener('Reflection'));
}

export function subscribeReflectionNav(listener: (screen: PendingScreen) => void): () => void {
  navListeners.add(listener);
  if (pendingScreen === 'Reflection') {
    pendingScreen = null;
    listener('Reflection');
  }
  return () => {
    navListeners.delete(listener);
  };
}

function isReflectionData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const screen = (data as { screen?: unknown }).screen;
  return screen === 'Reflection';
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'DOST',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function initNotificationRouting() {
  if (routingStarted) return;
  routingStarted = true;

  try {
    Notifications.addNotificationResponseReceivedListener((response) => {
      if (isReflectionData(response.notification.request.content.data)) {
        requestOpenReflection();
      }
    });
  } catch {
    // Expo Go / missing native module — in-app Reflect still works.
  }

  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (!consumedLaunchResponse && last && isReflectionData(last.notification.request.content.data)) {
      consumedLaunchResponse = true;
      requestOpenReflection();
      const clear = (Notifications as { clearLastNotificationResponseAsync?: () => Promise<void> })
        .clearLastNotificationResponseAsync;
      if (typeof clear === 'function') {
        await clear();
      }
    }
  } catch {
    // Ignore — Expo Go may not support this API.
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    return existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

function dailyTrigger(time: HmTime): Notifications.NotificationTriggerInput {
  const type = Notifications.SchedulableTriggerInputTypes?.DAILY;
  if (type) {
    return {
      type,
      hour: time.hour,
      minute: time.minute,
      channelId: CHANNEL_ID,
    };
  }
  return {
    hour: time.hour,
    minute: time.minute,
    repeats: true,
    channelId: CHANNEL_ID,
  } as Notifications.NotificationTriggerInput;
}

function dateTrigger(when: Date): Notifications.NotificationTriggerInput {
  const type = Notifications.SchedulableTriggerInputTypes?.DATE;
  if (type) {
    return {
      type,
      date: when,
      channelId: CHANNEL_ID,
    };
  }
  return { date: when, channelId: CHANNEL_ID } as Notifications.NotificationTriggerInput;
}

export async function scheduleEveningCheckIn(time: HmTime): Promise<{ scheduled: boolean; warning?: string }> {
  try {
    await ensureAndroidChannel();
    await Notifications.cancelScheduledNotificationAsync(EVENING_NEXT_ID).catch(() => undefined);
    await Notifications.cancelScheduledNotificationAsync(EVENING_DAILY_ID).catch(() => undefined);

    const next = nextOccurrence(time);
    let scheduled = false;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: EVENING_NEXT_ID,
        content: {
          title: 'DOST',
          body: EVENING_BODY,
          data: { screen: 'Reflection' },
          sound: true,
        },
        trigger: dateTrigger(next),
      });
      scheduled = true;
    } catch {
      try {
        const seconds = Math.max(1, Math.round((next.getTime() - Date.now()) / 1000));
        const intervalType = Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL;
        await Notifications.scheduleNotificationAsync({
          identifier: EVENING_NEXT_ID,
          content: {
            title: 'DOST',
            body: EVENING_BODY,
            data: { screen: 'Reflection' },
            sound: true,
          },
          trigger: intervalType
            ? { type: intervalType, seconds, repeats: false, channelId: CHANNEL_ID }
            : ({ seconds, repeats: false, channelId: CHANNEL_ID } as Notifications.NotificationTriggerInput),
        });
        scheduled = true;
      } catch {
        // Expo Go may block local schedules; in-app Reflect still works.
      }
    }

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: EVENING_DAILY_ID,
        content: {
          title: 'DOST',
          body: EVENING_BODY,
          data: { screen: 'Reflection' },
          sound: true,
        },
        trigger: dailyTrigger(time),
      });
      scheduled = true;
    } catch {
      // Daily repeating may require a Dev Client on Android.
    }

    if (!scheduled) {
      return {
        scheduled: false,
        warning:
          'Saved the time, but reminders may not fire in Expo Go. Use Reflect in the chat header to try the check-in.',
      };
    }

    return { scheduled: true };
  } catch {
    return {
      scheduled: false,
      warning:
        'Saved the time, but reminders may not fire in Expo Go. Use Reflect in the chat header to try the check-in.',
    };
  }
}

export async function restoreEveningScheduleIfAllowed() {
  try {
    const allowed = await hasNotificationPermission();
    if (!allowed) return;
    const time = await loadReflectionTime();
    await scheduleEveningCheckIn(time);
  } catch {
    // Non-fatal — chat must still open.
  }
}

export async function scheduleMorningNoticings(
  intentions: [string, string],
  forDate: string,
): Promise<{ scheduled: boolean }> {
  try {
    await ensureAndroidChannel();
    await Notifications.cancelScheduledNotificationAsync(MORNING_ID).catch(() => undefined);

    const when = morningOf(forDate, 8, 0);
    if (when.getTime() <= Date.now()) {
      when.setDate(when.getDate() + 1);
    }

    await Notifications.scheduleNotificationAsync({
      identifier: MORNING_ID,
      content: {
        title: 'DOST',
        body: `Two things you wanted to notice today: ${intentions[0]}, ${intentions[1]}`,
        data: { screen: 'Chat' },
        sound: true,
      },
      trigger: dateTrigger(when),
    });
    return { scheduled: true };
  } catch {
    return { scheduled: false };
  }
}
