import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dost_hearing_schedules';
const MAX_SCHEDULES = 7;

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type HearingSchedule = {
  id: number;
  hour: number;
  minute: number;
  days: DayOfWeek[];
  enabled: boolean;
};

type ScheduleStorage = {
  schedules: HearingSchedule[];
  nextId: number;
};

const ScheduleNative = NativeModules.HearingScheduleModule as
  | {
      setAlarm: (scheduleId: number, triggerAtMillis: number) => Promise<boolean>;
      cancelAlarm: (scheduleId: number) => Promise<boolean>;
      cancelAllAlarms: () => Promise<boolean>;
    }
  | undefined;

export async function getSchedules(): Promise<HearingSchedule[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: ScheduleStorage = JSON.parse(raw);
    return data.schedules ?? [];
  } catch {
    return [];
  }
}

export async function addSchedule(
  hour: number,
  minute: number,
  days: DayOfWeek[],
): Promise<HearingSchedule | null> {
  const store = await loadStore();
  if (store.schedules.length >= MAX_SCHEDULES) return null;

  const schedule: HearingSchedule = {
    id: store.nextId,
    hour,
    minute,
    days: days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
  };

  store.schedules.push(schedule);
  store.nextId++;
  await saveStore(store);
  await armNextAlarm(schedule);
  return schedule;
}

export async function removeSchedule(id: number): Promise<void> {
  const store = await loadStore();
  store.schedules = store.schedules.filter((s) => s.id !== id);
  await saveStore(store);
  await cancelNativeAlarm(id);
}

export async function toggleSchedule(
  id: number,
  enabled: boolean,
): Promise<void> {
  const store = await loadStore();
  const schedule = store.schedules.find((s) => s.id === id);
  if (!schedule) return;

  schedule.enabled = enabled;
  await saveStore(store);

  if (enabled) {
    await armNextAlarm(schedule);
  } else {
    await cancelNativeAlarm(id);
  }
}

export async function updateSchedule(
  id: number,
  hour: number,
  minute: number,
  days: DayOfWeek[],
): Promise<void> {
  const store = await loadStore();
  const schedule = store.schedules.find((s) => s.id === id);
  if (!schedule) return;

  schedule.hour = hour;
  schedule.minute = minute;
  schedule.days = days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
  await saveStore(store);

  if (schedule.enabled) {
    await armNextAlarm(schedule);
  }
}

export async function rearmAllSchedules(): Promise<void> {
  const schedules = await getSchedules();
  for (const s of schedules) {
    if (s.enabled) {
      await armNextAlarm(s);
    }
  }
}

export function subscribeScheduleAlarm(
  cb: (scheduleId: number) => void,
): () => void {
  const sub = DeviceEventEmitter.addListener(
    'HearingScheduleAlarm',
    (scheduleId: number) => cb(scheduleId),
  );
  return () => sub.remove();
}

async function armNextAlarm(schedule: HearingSchedule): Promise<void> {
  if (Platform.OS !== 'android' || !ScheduleNative) return;

  const nextTrigger = computeNextTrigger(schedule);
  if (!nextTrigger) return;

  try {
    await ScheduleNative.setAlarm(schedule.id, nextTrigger);
  } catch {
    // fail-open
  }
}

async function cancelNativeAlarm(id: number): Promise<void> {
  if (Platform.OS !== 'android' || !ScheduleNative) return;
  try {
    await ScheduleNative.cancelAlarm(id);
  } catch {
    // fail-open
  }
}

function computeNextTrigger(schedule: HearingSchedule): number | null {
  if (schedule.days.length === 0) return null;

  const now = new Date();
  const daysSet = new Set(schedule.days);

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);

    if (candidate.getTime() <= now.getTime()) continue;
    if (!daysSet.has(candidate.getDay() as DayOfWeek)) continue;

    return candidate.getTime();
  }

  return null;
}

async function loadStore(): Promise<ScheduleStorage> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { schedules: [], nextId: 1 };
}

async function saveStore(store: ScheduleStorage): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
