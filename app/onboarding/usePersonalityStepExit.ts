import { useNavigation, useRoute } from '@react-navigation/native';
import { isStandalonePersonalityEdit } from '../../lib/personalityProfile';

/** After save/skip: return to Settings when editing later, otherwise continue onboarding. */
export function usePersonalityStepExit(onboardingNext: () => void) {
  const navigation = useNavigation();
  const route = useRoute();
  const standalone = isStandalonePersonalityEdit(route.params);

  const exitStep = () => {
    if (standalone) {
      navigation.goBack();
      return;
    }
    onboardingNext();
  };

  return { standalone, exitStep };
}
