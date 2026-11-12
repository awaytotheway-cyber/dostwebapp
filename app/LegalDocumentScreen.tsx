import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, radius, spacing, type as typography } from '../lib/theme';
import { LEGAL_DOCUMENTS } from '../lib/legal';
import { useI18n } from '../lib/i18n';
import GentlePressable from './GentlePressable';
import type { ChatStackParamList } from './chatTypes';

type Props = NativeStackScreenProps<ChatStackParamList, 'Legal'>;

/**
 * Privacy Policy and Terms & Conditions, opened from Profile. The text
 * lives in lib/legal/ so replacing a draft with the reviewed version is a
 * one-file change; while a document is a draft, the banner says so.
 */
export default function LegalDocumentScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const doc = LEGAL_DOCUMENTS[route.params.doc];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <GentlePressable
          accessibilityRole="button"
          accessibilityLabel={t('common.backPlain')}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.back}>{t('common.back')}</Text>
        </GentlePressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing['4xl'] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {doc.title}
        </Text>
        <Text style={styles.updated}>{doc.lastUpdated}</Text>

        {doc.isDraft ? (
          <View style={styles.draftBanner} accessibilityRole="alert">
            <Text style={styles.draftText}>{t('legal.draftBanner')}</Text>
          </View>
        ) : null}

        {doc.intro ? <Text style={styles.intro}>{doc.intro}</Text> : null}

        {doc.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              {section.heading}
            </Text>
            {section.paragraphs.map((p, i) => (
              <Text key={i} style={styles.paragraph}>
                {p}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  back: { ...typography.label, color: colors.sand },
  pressed: { opacity: 0.7 },
  scroll: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  title: {
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 28,
    lineHeight: 34,
    color: colors.cream,
  },
  updated: { ...typography.caption, color: colors.clay, marginTop: -spacing.sm },
  draftBanner: {
    borderWidth: 1,
    borderColor: colors.terracottaDash,
    backgroundColor: colors.terracottaWash,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  draftText: { ...typography.caption, color: colors.cream, lineHeight: 18 },
  intro: { ...typography.body, color: colors.cream, lineHeight: 24 },
  section: { gap: spacing.sm },
  heading: {
    fontFamily: 'InstrumentSans_600SemiBold',
    fontSize: 18,
    lineHeight: 24,
    color: colors.cream,
  },
  paragraph: { ...typography.body, color: colors.sand, lineHeight: 24 },
});
