import { StyleSheet } from 'react-native';
import { fonts, colors, radius, spacing, type } from '../../lib/theme';

export const onboardingStyles = StyleSheet.create({
  // ── Core containers ─────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: colors.parchment,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  contentTop: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
  },
  centeredScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
  },

  // ── Typography ───────────────────────────────────────────────
  heading: {
    ...type.display,
    color: colors.inkDark,
    textAlign: 'left',
    marginBottom: spacing.lg,
  },
  headingLeft: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 40,
    color: colors.inkDark,
    marginBottom: spacing.xl,
  },
  headingWithLead: {
    marginBottom: spacing.md,
  },
  copy: {
    ...type.reflectivePrompt,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: spacing['3xl'],
  },
  copyLeft: {
    ...type.reflectivePrompt,
    color: colors.inkMuted,
    marginBottom: spacing.lg,
  },
  helper: {
    ...type.body,
    color: colors.inkMuted,
    marginTop: spacing.sm,
    marginBottom: spacing['2xl'],
  },
  eyebrow: {
    ...type.label,
    color: colors.terracotta,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  screenLead: {
    ...type.body,
    color: colors.inkMuted,
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    ...type.label,
    color: colors.inkMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  // ── Input — underline style (light mode) ────────────────────
  input: {
    borderWidth: 0,
    borderBottomWidth: 1.5,
    borderColor: colors.terracotta,
    minHeight: 52,
    paddingHorizontal: 0,
    paddingVertical: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 32,
    color: colors.inkDark,
    backgroundColor: 'transparent',
  },
  textArea: {
    minHeight: 112,
    textAlignVertical: 'top',
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.parchmentCard,
  },

  // ── CTA Button — terracotta ──────────────────────────────────
  button: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    backgroundColor: colors.terracotta,
    borderRadius: radius.cta,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    minHeight: 52,
    alignItems: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.terracottaSoft,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.onTerracotta,
    letterSpacing: 0.2,
  },

  // ── Footer ───────────────────────────────────────────────────
  footer: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.md,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },

  // ── Option cards ─────────────────────────────────────────────
  option: {
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.parchmentCard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionCard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    minHeight: 72,
    marginBottom: spacing.md,
  },
  textLinkWrap: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  textLink: {
    ...type.label,
    color: colors.terracotta,
    textAlign: 'center',
  },
  textLinkStartWrap: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: 0,
    marginBottom: spacing.md,
  },
  textLinkStart: {
    ...type.label,
    color: colors.terracotta,
    textAlign: 'left',
  },
  fieldHint: {
    ...type.body,
    color: colors.inkMuted,
    marginTop: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.terracotta,
    backgroundColor: colors.terracottaWash,
  },
  optionText: {
    ...type.body,
    flex: 1,
    color: colors.inkDark,
  },
  optionCopy: {
    flex: 1,
  },
  optionDescription: {
    ...type.caption,
    color: colors.inkMuted,
    marginTop: spacing.xs,
  },
  glyphFrame: {
    width: spacing['5xl'],
    height: spacing['5xl'],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.parchmentDeep,
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
  },
  glyphFrameSelected: {
    backgroundColor: colors.terracottaWash,
    borderColor: colors.terracotta,
  },
  selectionCount: {
    ...type.label,
    color: colors.terracotta,
    marginBottom: spacing.md,
  },
  question: {
    ...type.reflectivePrompt,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: colors.inkMuted,
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.parchmentCard,
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
  },
  toggleLabel: {
    flex: 1,
    ...type.body,
    color: colors.inkDark,
  },
  dateButton: {
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
    borderRadius: radius['2xl'],
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.parchmentCard,
  },
  dateButtonText: {
    ...type.body,
    color: colors.inkDark,
  },
  pickerFrame: {
    overflow: 'hidden',
    marginBottom: spacing.md,
    borderRadius: radius['2xl'],
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
    backgroundColor: colors.parchmentCard,
  },
  progressSection: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  progress: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  progressCount: {
    ...type.label,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  skipRemainingWrap: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  skipRemainingText: {
    ...type.label,
    color: colors.terracotta,
    textAlign: 'center',
  },
  // ── Dash-style progress indicators ──────────────────────────
  progressDot: {
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.terracottaDash,
  },
  progressDotComplete: {
    backgroundColor: colors.terracotta,
  },
  progressDotCurrent: {
    width: 28,
    backgroundColor: colors.terracotta,
  },
  doshaGlyphFrame: {
    width: spacing['4xl'],
    height: spacing['4xl'],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.parchmentDeep,
    borderWidth: 1,
    borderColor: colors.parchmentBorder,
  },
});
