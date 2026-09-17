import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';

/**
 * Static home-screen launcher for DOST.
 * Colors: dark base + cream + gold accent (calm on any wallpaper).
 * Soft rounded card — no hard edges.
 */
export function DostLauncherWidget() {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#1A1614',
        borderRadius: 32,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
      }}
      clickAction="OPEN_DOST"
    >
      <TextWidget
        text="DOST"
        style={{
          fontSize: 28,
          color: '#EDE4D3',
          fontFamily: 'serif',
        }}
      />
      {/* Soft gold accent (diya-like underline) */}
      <FlexWidget
        style={{
          width: 24,
          height: 3,
          backgroundColor: '#D9A857',
          borderRadius: 999,
          marginTop: 6,
          marginBottom: 8,
        }}
      />
      <TextWidget
        text="Tap to reflect"
        style={{
          fontSize: 14,
          color: '#C9B79C',
        }}
      />
    </FlexWidget>
  );
}
