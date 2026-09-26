import { PermissionsAndroid, Platform, Alert } from 'react-native';

export type HearingPermissionResult = {
  granted: boolean;
  reason?: 'not-android' | 'mic-denied' | 'notification-denied';
};

export async function requestHearingPermissions(): Promise<HearingPermissionResult> {
  if (Platform.OS !== 'android') {
    Alert.alert(
      'Not yet available',
      'Listening sessions are Android-only for now.',
    );
    return { granted: false, reason: 'not-android' };
  }

  const mic = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone access',
      message:
        'DOST needs your microphone to hear the texture of how you speak during a session. Audio never leaves your phone.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  if (mic !== PermissionsAndroid.RESULTS.GRANTED) {
    return { granted: false, reason: 'mic-denied' };
  }

  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    const notif = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: 'Show a listening indicator',
        message:
          'DOST shows a notification whenever a session is active, so you always know when it is listening.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      },
    );
    if (notif !== PermissionsAndroid.RESULTS.GRANTED) {
      return { granted: false, reason: 'notification-denied' };
    }
  }

  return { granted: true };
}
