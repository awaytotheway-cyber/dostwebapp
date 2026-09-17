import React from 'react';
import Svg, {
  Circle,
  Ellipse,
  Line,
  Path,
  Polyline,
} from 'react-native-svg';
import { colors } from '../../lib/theme';

export type PreferenceGlyphName =
  | 'day'
  | 'flexible'
  | 'night'
  | 'reading'
  | 'music'
  | 'movement'
  | 'nature'
  | 'art'
  | 'cooking'
  | 'travel'
  | 'games'
  | 'spiritual_practice'
  | 'introvert'
  | 'ambivert'
  | 'extrovert';

type Props = {
  name: PreferenceGlyphName;
  selected?: boolean;
  size?: number;
};

export default function PreferenceGlyph({ name, selected = false, size = 44 }: Props) {
  const stroke = selected ? colors.olive : colors.sand;
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      accessible={false}
      focusable={false}
    >
      {name === 'day' && (
        <>
          <Path d="M8 35a16 16 0 0 1 32 0" {...common} />
          <Line x1="5" y1="35" x2="43" y2="35" {...common} />
          <Line x1="24" y1="8" x2="24" y2="13" {...common} />
          <Line x1="9" y1="16" x2="13" y2="20" {...common} />
          <Line x1="39" y1="16" x2="35" y2="20" {...common} />
        </>
      )}
      {name === 'flexible' && (
        <>
          <Circle cx="15" cy="21" r="6" {...common} />
          <Line x1="15" y1="9" x2="15" y2="12" {...common} />
          <Line x1="6" y1="13" x2="8" y2="15" {...common} />
          <Path d="M34 14a8 8 0 1 0 5 14 7 7 0 0 1-5-14Z" {...common} />
          <Path d="M9 37c8-4 22-4 30 0" {...common} />
        </>
      )}
      {name === 'night' && (
        <>
          <Path d="M30 8a15 15 0 1 0 10 25 13 13 0 0 1-10-25Z" {...common} />
          <Circle cx="12" cy="14" r="1.5" fill={stroke} />
          <Circle cx="18" cy="8" r="1" fill={stroke} />
          <Path d="M8 39c9-3 23-3 32 0" {...common} />
        </>
      )}
      {name === 'reading' && (
        <>
          <Path d="M5 11c7-2 13 0 19 5v24c-6-5-12-7-19-5Z" {...common} />
          <Path d="M43 11c-7-2-13 0-19 5v24c6-5 12-7 19-5Z" {...common} />
          <Line x1="24" y1="16" x2="24" y2="40" {...common} />
        </>
      )}
      {name === 'music' && (
        <>
          <Path d="M18 34V13l20-4v21" {...common} />
          <Line x1="18" y1="19" x2="38" y2="15" {...common} />
          <Ellipse cx="12" cy="35" rx="6" ry="4" {...common} />
          <Ellipse cx="32" cy="31" rx="6" ry="4" {...common} />
        </>
      )}
      {name === 'movement' && (
        <>
          <Circle cx="27" cy="9" r="4" {...common} />
          <Path d="m24 16-7 9 8 4 5-10 7 7" {...common} />
          <Path d="m25 29-7 11M25 29l10 9" {...common} />
          <Line x1="17" y1="25" x2="9" y2="22" {...common} />
        </>
      )}
      {name === 'nature' && (
        <>
          <Path d="M40 7C22 9 9 20 10 38c18 1 30-12 30-31Z" {...common} />
          <Path d="M9 40c7-10 15-17 25-25" {...common} />
          <Path d="M19 29v-8M25 23h8" {...common} />
        </>
      )}
      {name === 'art' && (
        <>
          <Path d="M24 7C13 7 6 15 6 25c0 9 7 16 14 16 5 0 5-5 9-5h5c5 0 8-4 8-9C42 16 34 7 24 7Z" {...common} />
          <Circle cx="15" cy="21" r="2" fill={stroke} />
          <Circle cx="21" cy="15" r="2" fill={stroke} />
          <Circle cx="29" cy="16" r="2" fill={stroke} />
          <Circle cx="34" cy="23" r="2" fill={stroke} />
        </>
      )}
      {name === 'cooking' && (
        <>
          <Path d="M10 22h28v8c0 7-5 11-12 11h-4c-7 0-12-4-12-11Z" {...common} />
          <Line x1="6" y1="22" x2="42" y2="22" {...common} />
          <Path d="M17 17c-3-3 2-5 0-9M25 17c-3-3 2-5 0-9M33 17c-3-3 2-5 0-9" {...common} />
        </>
      )}
      {name === 'travel' && (
        <>
          <Circle cx="24" cy="24" r="18" {...common} />
          <Path d="m30 18-4 10-10 4 4-10Z" {...common} />
          <Circle cx="24" cy="24" r="2" fill={stroke} />
        </>
      )}
      {name === 'games' && (
        <>
          <Path d="M15 17h18c6 0 10 6 9 14l-1 6c-1 4-6 5-9 1l-4-5h-8l-4 5c-3 4-8 3-9-1l-1-6c-1-8 3-14 9-14Z" {...common} />
          <Line x1="14" y1="27" x2="22" y2="27" {...common} />
          <Line x1="18" y1="23" x2="18" y2="31" {...common} />
          <Circle cx="32" cy="25" r="1.5" fill={stroke} />
          <Circle cx="36" cy="29" r="1.5" fill={stroke} />
        </>
      )}
      {name === 'spiritual_practice' && (
        <>
          <Circle cx="24" cy="10" r="4" {...common} />
          <Path d="M24 14v13M24 19l-9 8M24 19l9 8" {...common} />
          <Path d="M24 27c-4 0-7 2-9 7l-7 5h32l-7-5c-2-5-5-7-9-7Z" {...common} />
        </>
      )}
      {name === 'introvert' && (
        <>
          <Circle cx="24" cy="24" r="5" {...common} />
          <Path d="M13 12c-9 7-9 17 0 24M17 17c-5 4-5 10 0 14" {...common} />
          <Polyline points="13,8 13,12 17,12" {...common} />
          <Polyline points="13,40 13,36 17,36" {...common} />
        </>
      )}
      {name === 'ambivert' && (
        <>
          <Circle cx="16" cy="22" r="5" {...common} />
          <Circle cx="32" cy="22" r="5" {...common} />
          <Path d="M7 38c1-7 5-11 9-11s8 4 9 11M23 38c1-7 5-11 9-11s8 4 9 11" {...common} />
          <Line x1="24" y1="8" x2="24" y2="13" {...common} />
        </>
      )}
      {name === 'extrovert' && (
        <>
          <Circle cx="24" cy="20" r="5" {...common} />
          <Circle cx="11" cy="24" r="4" {...common} />
          <Circle cx="37" cy="24" r="4" {...common} />
          <Path d="M15 40c1-8 4-13 9-13s8 5 9 13M4 40c1-7 3-11 7-11 2 0 4 1 5 3M44 40c-1-7-3-11-7-11-2 0-4 1-5 3" {...common} />
          <Line x1="24" y1="6" x2="24" y2="10" {...common} />
          <Line x1="9" y1="10" x2="13" y2="14" {...common} />
          <Line x1="39" y1="10" x2="35" y2="14" {...common} />
        </>
      )}
    </Svg>
  );
}
