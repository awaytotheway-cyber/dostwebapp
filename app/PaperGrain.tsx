import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

const SPECKS = [
  ['4%', '7%'],
  ['18%', '15%'],
  ['37%', '5%'],
  ['58%', '18%'],
  ['79%', '9%'],
  ['94%', '21%'],
  ['9%', '33%'],
  ['29%', '27%'],
  ['49%', '39%'],
  ['71%', '31%'],
  ['88%', '43%'],
  ['3%', '56%'],
  ['22%', '48%'],
  ['41%', '62%'],
  ['63%', '53%'],
  ['83%', '66%'],
  ['14%', '76%'],
  ['34%', '71%'],
  ['55%', '84%'],
  ['75%', '78%'],
  ['96%', '89%'],
  ['7%', '94%'],
  ['45%', '97%'],
  ['87%', '96%'],
] as const;

export default function PaperGrain() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      {SPECKS.map(([left, top], index) => (
        <View
          key={`${left}-${top}`}
          style={[
            styles.speck,
            {
              left,
              top,
              opacity: index % 3 === 0 ? 0.05 : 0.03,
              transform: [{ rotate: index % 2 === 0 ? '18deg' : '-22deg' }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  speck: {
    position: 'absolute',
    width: 2,
    height: 1,
    borderRadius: 1,
    backgroundColor: colors.olive,
  },
});
