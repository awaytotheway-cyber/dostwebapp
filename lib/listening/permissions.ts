import { PermissionsAndroid, Platform, Alert } from 'react-native';
import { t as translate } from '../i18n';

export type ListeningPermissionResult = {
  granted: boolean;
  reason?: 'not-android' | 'mic-denied' | 'notification-denied';
};

export async function requestListeningPermissions(): Promise<ListeningPermissionResult> {
  if (Platform.OS !== 'android') {
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
