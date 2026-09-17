import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OnboardingStackParamList } from './types';
import { onboardingStyles as styles } from './styles';
import OnboardingProgress from './OnboardingProgress';
import { colors, spacing } from '../../lib/theme';
import GentlePressable from '../GentlePressable';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Birth'>;

function defaultBirthDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 25);
  return d;
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeOnly(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}:00`;
}

export default function BirthScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [date, setDate] = useState(defaultBirthDate);
  const [time, setTime] = useState(defaultBirthDate);
  const [unknownTime, setUnknownTime] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(Platform.OS === 'ios');
  const [showTimePicker, setShowTimePicker] = useState(false);

  const dateLabel = useMemo(
    () =>
      date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [date],
  );

  const timeLabel = useMemo(
    () =>
      time.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [time],
  );

  const onDateChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selected) setDate(selected);
  };

  const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (event.type === 'dismissed') return;
    if (selected) setTime(selected);
  };

  const onContinue = () => {
    navigation.navigate('BirthPlace', {
      name: route.params.name,
      intention: route.params.intention,
      dob: toDateOnly(date),
      dobTime: unknownTime ? null : toTimeOnly(time),
    });
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm },
      ]}
    >
      <OnboardingProgress />
      <ScrollView
        style={styles.contentTop}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={styles.headingLeft}>
          When were you born?
        </Text>

        {Platform.OS === 'android' ? (
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={({ pressed }) => [styles.dateButton, pressed && styles.optionSelected]}
          >
            <Text style={styles.dateButtonText}>{dateLabel}</Text>
          </Pressable>
        ) : (
          <Text style={styles.copyLeft}>{dateLabel}</Text>
        )}

        {showDatePicker && Platform.OS === 'android' ? (
          <DateTimePicker
            value={date}
            mode="date"
            display="default"
            onChange={onDateChange}
            maximumDate={new Date()}
          />
        ) : null}
        {Platform.OS === 'ios' ? (
          <View style={styles.pickerFrame}>
            <DateTimePicker
              value={date}
              mode="date"
              display="spinner"
              onChange={onDateChange}
              maximumDate={new Date()}
              textColor={colors.cream}
              accentColor={colors.gold}
              themeVariant="light"
            />
          </View>
        ) : null}

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>I don't know the time</Text>
          <Switch
            value={unknownTime}
            onValueChange={(value) => {
              setUnknownTime(value);
              if (value) setShowTimePicker(false);
            }}
            trackColor={{ false: colors.divider, true: colors.olive }}
            thumbColor={unknownTime ? colors.onPrimary : colors.sand}
            ios_backgroundColor={colors.divider}
          />
        </View>

        {!unknownTime ? (
          Platform.OS === 'android' ? (
            <Pressable
              onPress={() => setShowTimePicker(true)}
              style={({ pressed }) => [styles.dateButton, pressed && styles.optionSelected]}
            >
              <Text style={styles.dateButtonText}>{timeLabel}</Text>
            </Pressable>
          ) : (
            <Text style={styles.copyLeft}>{timeLabel}</Text>
          )
        ) : null}

        {!unknownTime && showTimePicker && Platform.OS === 'android' ? (
          <DateTimePicker
            value={time}
            mode="time"
            display="default"
            onChange={onTimeChange}
          />
        ) : null}
        {!unknownTime && Platform.OS === 'ios' ? (
          <View style={styles.pickerFrame}>
            <DateTimePicker
              value={time}
              mode="time"
              display="spinner"
              onChange={onTimeChange}
              textColor={colors.cream}
              accentColor={colors.gold}
              themeVariant="light"
            />
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <GentlePressable
          onPress={onContinue}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </GentlePressable>
      </View>
    </View>
  );
}
