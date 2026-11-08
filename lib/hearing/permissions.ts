import { PermissionsAndroid, Platform, Alert } from 'react-native';
import { t as translate } from '../i18n';
import { hearingBackend } from './nativeHearing';

export type HearingPermissionResult = {
  granted: boolean;
  reason?: 'not-android' | 'mic-denied' | 'notification-denied';
};

export async function requestHearingPermissions(): Promise<HearingPermissionResult> {
  const backend = hearingBackend();

  // iOS: the microphone is the only permission. There is no notification
  // step — iOS shows its own microphone indicator while a session runs.
  // iOS asks once; after a "Don't Allow" it answers false without asking
  // again, and the caller's "grant it in Settings" message is the way back.
  if (Platform.OS === 'ios' && backend?.module.requestMicrophonePermission) {
    const granted = await backend.module.requestMicrophonePermission();
    return granted ? { granted: true } : { granted: false, reason: 'mic-denied' };
  }

  if (Platform.OS !== 'android') {
    // Web, or an iOS build that predates listening on iOS.
    Alert.alert(translate('permissions.notYetAvailable'), translate('permissions.androidOnly'));
    return { granted: false, reason: 'not-android' };
  }

  const mic = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: translate('permissions.micTitle'),
      message: translate('permissions.micBody'),
      buttonPositive: translate('permissions.allow'),
      buttonNegative: translate('permissions.notNow'),
    },
  );
  if (mic !== PermissionsAndroid.RESULTS.GRANTED) {
    return { granted: false, reason: 'mic-denied' };
  }

  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    const notif = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      {
        title: translate('permissions.notificationTitle'),
        message: translate('permissions.notificationBody'),
        buttonPositive: translate('permissions.allow'),
        buttonNegative: translate('permissions.notNow'),
      },
    );
    if (notif !== PermissionsAndroid.RESULTS.GRANTED) {
      return { granted: false, reason: 'notification-denied' };
    }
  }

  return { granted: true };
}
