import AsyncStorage from '@react-native-async-storage/async-storage';

function sessionKey(userId: string): string {
  return `dost_chat_session_start_${userId}`;
}

/** Soft session boundary: only messages at/after this time show in the main chat. */
export async function getChatSessionStart(userId: string): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(sessionKey(userId));
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function startNewChatSession(userId: string): Promise<string> {
  const startedAt = new Date().toISOString();
  await AsyncStorage.setItem(sessionKey(userId), startedAt);
  return startedAt;
}

/** Open history around a message by setting the session start to that message's time. */
export async function openChatFromMessage(
  userId: string,
  createdAt: string,
): Promise<string> {
  await AsyncStorage.setItem(sessionKey(userId), createdAt);
  return createdAt;
}

export async function clearChatSessionStart(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(sessionKey(userId));
  } catch {
    // Ignore storage errors.
  }
}
