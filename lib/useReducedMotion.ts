import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cachedReducedMotion: boolean | null = null;

export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(cachedReducedMotion ?? true);

  useEffect(() => {
    let mounted = true;
    const update = (enabled: boolean) => {
      cachedReducedMotion = enabled;
      if (mounted) setReduceMotion(enabled);
    };

    void AccessibilityInfo.isReduceMotionEnabled().then(update);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      update,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
