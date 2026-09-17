import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../lib/theme';
import type { DoshaPick } from './types';

type Props = {
  dosha: DoshaPick;
  selected?: boolean;
};

export default function DoshaGlyph({ dosha, selected = false }: Props) {
  const stroke = selected ? colors.olive : colors.clay;

  return (
    <Svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {dosha === 'vata' ? (
        <>
          <Path
            d="M3.5 9.25h9.7c2.15 0 3.3-.96 3.3-2.45 0-1.27-.91-2.3-2.35-2.3-1.08 0-1.9.5-2.45 1.48"
            stroke={stroke}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <Path
            d="M3.5 13h13.8c2.02 0 3.2 1.08 3.2 2.65 0 1.5-1.12 2.85-2.78 2.85-1.22 0-2.18-.6-2.72-1.65"
            stroke={stroke}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </>
      ) : dosha === 'pitta' ? (
        <Path
          d="M12.35 2.8c.55 3.75-2.95 5.18-2.18 8.1.35 1.3 1.35 1.82 2.08 2.15-.15-2.12 1.05-3.67 2.58-4.9 2.62 2.4 3.67 4.7 3.07 7.42-.63 2.85-2.97 4.63-5.9 4.63-3.38 0-5.95-2.38-5.95-5.85 0-4.05 3.2-7.98 6.3-11.55Z"
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ) : (
        <Path
          d="M12 2.9c2.55 3.5 6.05 7.45 6.05 11.05A6.05 6.05 0 1 1 5.95 14C5.95 10.35 9.45 6.4 12 2.9Z"
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      )}
    </Svg>
  );
}
