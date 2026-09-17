import React, { useCallback, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  fetchJourneyInsight,
  JOURNEY_RANGES,
  loadJourneyAggregate,
  toneForEmotion,
  type JourneyAggregate,
  type JourneyRangeKey,
} from '../lib/journey';
import { radius, spacing, type as typography } from '../lib/theme';
import type { ChatStackParamList } from './chatTypes';
import BreathingDot from './BreathingDot';
import GentlePressable from './GentlePressable';
import PaperGrain from './PaperGrain';

type Props = NativeStackScreenProps<ChatStackParamList, 'YourJourney'>;

/** Dark home-family surface — matches Home / Past Reflections Dawn Earth. */
const dawn = {
  base: '#1A1614',
  card: '#241E1B',
  cream: '#EDE4D3',
  sand: '#C9B79C',
  gold: '#D9A857',
  clay: '#B8A090',
  border: 'rgba(201, 183, 156, 0.22)',
  segmentIdle: 'rgba(36, 30, 27, 0.9)',
} as const;

function WeatherChart({
  points,
}: {
  points: JourneyAggregate['weather'];
}) {
  const [width, setWidth] = useState(0);
  const height = 112;
  const padX = 10;
  const padY = 18;

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const drawn = useMemo(() => {
    if (width <= 0 || points.length === 0) return null;

    const maxCount = Math.max(1, ...points.map((p) => p.count));
    const innerW = Math.max(1, width - padX * 2);
    const innerH = Math.max(1, height - padY * 2);
    const n = points.length;

    const coords = points.map((p, i) => {
      const x = padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const t = p.count > 0 ? p.count / maxCount : 0;
      // Soft mid-band when empty so the line stays gentle.
      const y = padY + innerH * (1 - (p.count > 0 ? 0.22 + t * 0.7 : 0.12));
      return { x, y, point: p };
    });

    const active = coords.filter((c) => c.point.count > 0);
    if (active.length === 0) return { coords, path: '' };

    let d = `M ${active[0].x.toFixed(1)} ${active[0].y.toFixed(1)}`;
    for (let i = 1; i < active.length; i += 1) {
      const prev = active[i - 1];
      const curr = active[i];
      const cx = (prev.x + curr.x) / 2;
      d += ` Q ${cx.toFixed(1)} ${prev.y.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }

    return { coords, path: d };
  }, [points, width]);

  return (
    <View style={styles.chartWrap} onLayout={onLayout}>
      {width > 0 && drawn ? (
        <Svg width={width} height={height}>
          {drawn.path ? (
            <Path
              d={drawn.path}
              stroke="rgba(201, 183, 156, 0.45)"
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {drawn.coords.map((c) => {
            if (c.point.count <= 0) {
              return (
                <Circle
                  key={c.point.dayKey}
                  cx={c.x}
                  cy={c.y}
                  r={2.2}
                  fill="rgba(201, 183, 156, 0.28)"
                />
              );
            }
            return (
              <Circle
                key={c.point.dayKey}
                cx={c.x}
                cy={c.y}
                r={5}
                fill={toneForEmotion(c.point.dominant)}
                opacity={0.92}
              />
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

function SoftLoading({ label }: { label: string }) {
  return (
    <View style={styles.loadingRow} accessibilityLabel={label}>
      <BreathingDot size={10} color={dawn.clay} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export default function YourJourneyScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<JourneyRangeKey>('7d');
  const [aggregate, setAggregate] = useState<JourneyAggregate | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rangeLabel =
    JOURNEY_RANGES.find((r) => r.key === range)?.label ?? 'Past 7 days';

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        setError(null);
        setLoading(true);
        setInsight(null);
        setInsightError(null);
        setInsightLoading(false);

        const result = await loadJourneyAggregate(range);
        if (!active) return;

        if (!result.ok) {
          setAggregate(null);
          setError(result.message);
          setLoading(false);
          return;
        }

        setAggregate(result.aggregate);
        setLoading(false);

        if (result.aggregate.sparse) {
          setInsight(null);
          return;
        }

        setInsightLoading(true);
        const insightRes = await fetchJourneyInsight({
          rangeKey: range,
          rangeLabel,
          emotionCounts: result.aggregate.emotionCounts,
          topNeeds: result.aggregate.topNeeds.map((n) => n.token),
        });
        if (!active) return;
        setInsightLoading(false);

        if (!insightRes.ok) {
          setInsight(null);
          setInsightError(insightRes.message);
          return;
        }
        setInsightError(null);
        setInsight(insightRes.insight);
      })();

      return () => {
        active = false;
      };
    }, [range, rangeLabel]),
  );

  const onSelectRange = (key: JourneyRangeKey) => {
    if (key === range) return;
    setRange(key);
  };

  const retryInsight = useCallback(async () => {
    if (!aggregate || aggregate.sparse) return;

    setInsightError(null);
    setInsightLoading(true);
    const insightRes = await fetchJourneyInsight({
      rangeKey: range,
      rangeLabel,
      emotionCounts: aggregate.emotionCounts,
      topNeeds: aggregate.topNeeds.map((n) => n.token),
    });
    setInsightLoading(false);

    if (!insightRes.ok) {
      setInsight(null);
      setInsightError(insightRes.message);
      return;
    }
    setInsightError(null);
    setInsight(insightRes.insight);
  }, [aggregate, range, rangeLabel]);

  const empty =
    !loading &&
    !error &&
    (!aggregate || aggregate.totalTags === 0 || aggregate.sparse);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PaperGrain />
      <View style={styles.header}>
        <GentlePressable
          onPress={() => navigation.navigate('Home')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.back}>Home</Text>
        </GentlePressable>
        <Text
          accessibilityRole="header"
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          Your Journey
        </Text>
      </View>

      <View style={styles.segments}>
        {JOURNEY_RANGES.map(({ key, label }) => {
          const selected = range === key;
          return (
            <GentlePressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => onSelectRange(key)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  selected && styles.segmentLabelSelected,
                ]}
              >
                {label}
              </Text>
            </GentlePressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <SoftLoading label="Gathering your weather…" />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.empty}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + spacing['4xl'] },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {empty ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>
                Your journey is still gathering — a little more reflection, and
                the weather of your days will begin to show.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>The weather of your days</Text>
                <Text style={styles.sectionHint}>
                  Soft traces across {rangeLabel.toLowerCase()}.
                </Text>
                {aggregate ? <WeatherChart points={aggregate.weather} /> : null}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recurring themes</Text>
                {aggregate?.themeSentences.map((sentence) => (
                  <Text key={sentence} style={styles.themeLine}>
                    {sentence}
                  </Text>
                ))}
                {aggregate && aggregate.topNeeds.length > 0 ? (
                  <Text style={styles.needsHint}>
                    Underneath, a reach toward{' '}
                    {aggregate.topNeeds
                      .slice(0, 3)
                      .map((n) => n.label.toLowerCase())
                      .join(', ')}
                    .
                  </Text>
                ) : null}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>What DOST notices</Text>
                {insightLoading ? (
                  <SoftLoading label="Listening for what wants noticing…" />
                ) : insight ? (
                  <Text style={styles.insight}>{insight}</Text>
                ) : insightError ? (
                  <View style={styles.insightErrorWrap}>
                    <Text style={styles.insightErrorText}>{insightError}</Text>
                    <GentlePressable
                      accessibilityRole="button"
                      accessibilityLabel="Try again"
                      onPress={() => void retryInsight()}
                      style={({ pressed }) => [
                        styles.retryButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.retryLabel}>Try again</Text>
                    </GentlePressable>
                  </View>
                ) : (
                  <Text style={styles.themeLine}>
                    I am still sitting with what you have shared — check back
                    when a little more weather has gathered.
                  </Text>
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: dawn.base,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  back: {
    ...typography.label,
    color: dawn.sand,
  },
  title: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 28,
    lineHeight: 34,
    color: dawn.cream,
  },
  pressed: { opacity: 0.7 },
  segments: {
    flexDirection: 'row',
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: dawn.segmentIdle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dawn.border,
    gap: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: dawn.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(217, 168, 87, 0.35)',
  },
  segmentLabel: {
    ...typography.label,
    fontSize: 11,
    lineHeight: 14,
    color: dawn.sand,
    textAlign: 'center',
  },
  segmentLabelSelected: {
    color: dawn.cream,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    gap: spacing['3xl'],
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 20,
    lineHeight: 26,
    color: dawn.cream,
  },
  sectionHint: {
    ...typography.caption,
    color: dawn.sand,
    marginTop: -spacing.xs,
  },
  chartWrap: {
    marginTop: spacing.sm,
    minHeight: 112,
  },
  themeLine: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: dawn.cream,
  },
  needsHint: {
    ...typography.body,
    color: dawn.sand,
    marginTop: spacing.xs,
  },
  insight: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 26,
    color: dawn.cream,
  },
  insightErrorWrap: {
    gap: spacing.md,
  },
  insightErrorText: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 26,
    color: dawn.sand,
    fontStyle: 'italic',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: dawn.gold,
  },
  retryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    color: dawn.gold,
    textAlign: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: dawn.sand,
    fontStyle: 'italic',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
  },
  emptyWrap: {
    paddingTop: spacing['5xl'],
    paddingHorizontal: spacing.sm,
  },
  empty: {
    fontFamily: 'Fraunces_500Medium',
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: dawn.sand,
    textAlign: 'center',
  },
});
