import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import theme from '../lib/theme';
import { getListenStatus, stopListening } from '../lib/listening/listenBridge';
import { deleteAllListeningData, recordingsUsage } from '../lib/listening/voiceFiles';
import { t as translate, useI18n } from '../lib/i18n';

/**
 * Settings → Listening. Shows what listening has stored on this phone and
 * deletes all of it. Delete means delete from disk: the folder is listed
 * again afterwards and the number of files left is shown.
 */
export default function HearingSettingsSection() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await recordingsUsage());
    } catch {
      setUsage(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadUsage();
    }, [loadUsage]),
  );

  const performDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopListening();
      // Wait for the service to write its last lines before deleting.
      for (let i = 0; i < 50; i++) {
        if (!(await getListenStatus()).running) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const left = await deleteAllListeningData();
      await loadUsage();
      if (left === 0) {
        Alert.alert(t('hearingSettings.deleted'), t('hearingSettings.deletedBody', { count: 0 }));
      } else {
        Alert.alert(
          t('settings.couldNotDelete'),
          t('hearingSettings.notAllDeleted', { count: left }),
        );
      }
    } catch (e) {
      Alert.alert(
        t('settings.couldNotDelete'),
        e instanceof Error ? e.message : t('common.pleaseTryAgain'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAll = () => {
    Alert.alert(t('hearingSettings.deleteAllTitle'), t('hearingSettings.deleteAllBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void performDelete() },
    ]);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('hearingSettings.title')}</Text>
      <Text style={styles.sectionIntro}>{t('hearingSettings.intro')}</Text>

      <View style={styles.stat}>
        <Text style={styles.statLabel}>{t('hearingSettings.stored')}</Text>
        <Text style={styles.statValue}>
          {usage
            ? t('hearingSettings.storedValue', { count: usage.files, size: formatSize(usage.bytes) })
            : '—'}
        </Text>
      </View>

      <Pressable
        onPress={onDeleteAll}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('hearingSettings.deleteAllA11y')}
        style={({ pressed }) => [
          styles.dangerButton,
          pressed && { opacity: 0.7 },
          busy && { opacity: 0.5 },
        ]}
      >
        <Text style={styles.dangerButtonText}>
          {busy ? t('common.deleting') : t('hearingSettings.deleteAll')}
        </Text>
      </Pressable>
    </View>
  );
}

function formatSize(bytes: number): string {
  return translate('hearingSettings.mb', { value: (bytes / (1024 * 1024)).toFixed(1) });
}

const styles = StyleSheet.create({
  section: {
    marginTop: theme.spacing['2xl'],
    marginBottom: theme.spacing['2xl'],
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    paddingTop: theme.spacing['2xl'],
  },
  sectionTitle: {
    ...theme.type.heading,
    fontSize: 20,
    lineHeight: 24,
    color: theme.colors.cream,
    marginBottom: theme.spacing.xs,
  },
  sectionIntro: {
    ...theme.type.body,
    color: theme.colors.sand,
    marginBottom: theme.spacing.lg,
  },
  stat: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  statLabel: { ...theme.type.caption, color: theme.colors.clay },
  statValue: {
    ...theme.type.heading,
    fontSize: 18,
    lineHeight: 22,
    color: theme.colors.cream,
    marginTop: 4,
  },
  dangerButton: {
    minHeight: theme.spacing['4xl'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.cta,
    borderWidth: 1,
    borderColor: theme.colors.error,
    paddingHorizontal: theme.spacing['2xl'],
    paddingVertical: theme.spacing.sm,
    backgroundColor: 'transparent',
  },
  dangerButtonText: {
    ...theme.type.label,
    color: theme.colors.error,
    fontSize: 14,
  },
});
