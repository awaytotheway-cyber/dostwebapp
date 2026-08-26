import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COUNTRIES } from '../lib/birthPlace';

type Props = {
  value: string;
  onChange: (country: string) => void;
  disabled?: boolean;
};

export default function CountryPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        style={[styles.button, disabled && styles.disabled]}
        accessibilityLabel="Country"
      >
        <Text style={styles.buttonText}>{value || 'India'}</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.card}>
            <Text style={styles.title}>Country</Text>
            <ScrollView style={styles.list}>
              {COUNTRIES.map((country) => {
                const selected = country === value;
                return (
                  <Pressable
                    key={country}
                    onPress={() => {
                      onChange(country);
                      setOpen(false);
                    }}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <Text style={styles.optionText}>{country}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  disabled: { opacity: 0.4 },
  buttonText: { fontSize: 16, color: '#0f172a' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    maxHeight: '70%',
    zIndex: 1,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  list: { maxHeight: 360 },
  option: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  optionSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  optionText: { fontSize: 16, color: '#0f172a' },
  cancel: { alignSelf: 'center', paddingVertical: 8, marginTop: 4 },
  cancelText: { fontSize: 16, color: '#2563eb', fontWeight: '600' },
});
