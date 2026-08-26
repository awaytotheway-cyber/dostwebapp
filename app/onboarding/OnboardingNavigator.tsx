import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from './WelcomeScreen';
import NameScreen from './NameScreen';
import IntentionScreen from './IntentionScreen';
import BirthScreen from './BirthScreen';
import BirthPlaceScreen from './BirthPlaceScreen';
import DoshaScreen from './DoshaScreen';
import ConfirmScreen from './ConfirmScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

type Props = {
  onFinished: () => void;
};

export default function OnboardingNavigator({ onFinished }: Props) {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Name" component={NameScreen} />
        <Stack.Screen name="Intention" component={IntentionScreen} />
        <Stack.Screen name="Birth" component={BirthScreen} />
        <Stack.Screen name="BirthPlace" component={BirthPlaceScreen} />
        <Stack.Screen name="Dosha" component={DoshaScreen} />
        <Stack.Screen name="Confirm">
          {(props) => <ConfirmScreen {...props} onFinished={onFinished} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
