import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from './WelcomeScreen';
import NameScreen from './NameScreen';
import IntentionScreen from './IntentionScreen';
import BirthScreen from './BirthScreen';
import BirthPlaceScreen from './BirthPlaceScreen';
import DoshaScreen from './DoshaScreen';
import EnneagramScreen from './EnneagramScreen';
import NumerologyScreen from './NumerologyScreen';
import TCMScreen from './TCMScreen';
import MBTIScreen from './MBTIScreen';
import VarnaScreen from './VarnaScreen';
import ConfirmScreen from './ConfirmScreen';
import type { OnboardingStackParamList } from './types';
import { colors } from '../../lib/theme';
import { useReducedMotion } from '../../lib/useReducedMotion';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

type Props = {
  onFinished: () => void;
};

export default function OnboardingNavigator({ onFinished }: Props) {
  const reduceMotion = useReducedMotion();
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{
          headerShown: false,
          animation: reduceMotion ? 'none' : 'fade',
          contentStyle: { backgroundColor: colors.base },
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Name" component={NameScreen} />
        <Stack.Screen name="Intention" component={IntentionScreen} />
        <Stack.Screen name="Birth" component={BirthScreen} />
        <Stack.Screen name="BirthPlace" component={BirthPlaceScreen} />
        <Stack.Screen name="Dosha" component={DoshaScreen} />
        <Stack.Screen name="Enneagram" component={EnneagramScreen} />
        <Stack.Screen name="Numerology" component={NumerologyScreen} />
        <Stack.Screen name="TCM" component={TCMScreen} />
        <Stack.Screen name="MBTI" component={MBTIScreen} />
        <Stack.Screen name="Varna" component={VarnaScreen} />
        <Stack.Screen name="Confirm">
          {(props) => <ConfirmScreen {...props} onFinished={onFinished} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
