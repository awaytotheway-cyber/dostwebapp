import React, { useCallback, useEffect, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from './ChatScreen';
import SettingsScreen from './SettingsScreen';
import ReflectionScreen from './ReflectionScreen';
import DoshaRetakeScreen from './DoshaRetakeScreen';
import SearchChatsScreen from './SearchChatsScreen';
import HomeScreen from './HomeScreen';
import VoiceNoteRecordScreen from './VoiceNoteRecordScreen';
import VoiceNoteDetailScreen from './VoiceNoteDetailScreen';
import PastReflectionsScreen from './PastReflectionsScreen';
import YourJourneyScreen from './YourJourneyScreen';
import ProfileScreen from './ProfileScreen';
import AboutScreen from './AboutScreen';
import PersonalityProfileScreen from './PersonalityProfileScreen';
import HearingDisclosureScreen from './HearingDisclosureScreen';
import ListeningSessionScreen from './ListeningSessionScreen';
import SpeakerEnrollmentScreen from './SpeakerEnrollmentScreen';
import EnneagramScreen from './onboarding/EnneagramScreen';
import NumerologyScreen from './onboarding/NumerologyScreen';
import TCMScreen from './onboarding/TCMScreen';
import MBTIScreen from './onboarding/MBTIScreen';
import type { ChatStackParamList } from './chatTypes';
import {
  initNotificationRouting,
  restoreEveningScheduleIfAllowed,
  subscribeReflectionNav,
} from '../lib/notifications';
import { colors } from '../lib/theme';
import { useReducedMotion } from '../lib/useReducedMotion';

const Stack = createNativeStackNavigator<ChatStackParamList>();
const navigationRef = createNavigationContainerRef<ChatStackParamList>();

type Props = {
  onStartOver: () => void;
};

export default function ChatNavigator({ onStartOver }: Props) {
  const reduceMotion = useReducedMotion();
  const onStartOverRef = useRef(onStartOver);
  onStartOverRef.current = onStartOver;
  const pendingScreen = useRef<'Chat' | 'Reflection' | null>(null);

  const openNotificationScreen = useCallback((screen: 'Chat' | 'Reflection') => {
    if (navigationRef.isReady()) {
      if (screen === 'Reflection') {
        navigationRef.navigate('Reflection', { mode: 'prompt' });
      } else {
        navigationRef.navigate('Chat');
      }
      return;
    }
    pendingScreen.current = screen;
  }, []);

  useEffect(() => {
    initNotificationRouting();
    const unsub = subscribeReflectionNav((screen) => {
      openNotificationScreen(screen);
    });
    void restoreEveningScheduleIfAllowed();
    return unsub;
  }, [openNotificationScreen]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        const screen = pendingScreen.current;
        if (screen) {
          pendingScreen.current = null;
          if (screen === 'Reflection') {
            navigationRef.navigate('Reflection', { mode: 'prompt' });
          } else {
            navigationRef.navigate('Chat');
          }
        }
      }}
    >
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          animation: reduceMotion ? 'none' : 'fade',
          contentStyle: { backgroundColor: colors.base },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Chat">
          {(props) => (
            <ChatScreen {...props} onStartOver={() => onStartOverRef.current()} />
          )}
        </Stack.Screen>
        <Stack.Screen name="Settings">
          {(props) => (
            <SettingsScreen {...props} onStartOver={() => onStartOverRef.current()} />
          )}
        </Stack.Screen>
        <Stack.Screen name="Reflection" component={ReflectionScreen} />
        <Stack.Screen name="DoshaRetake" component={DoshaRetakeScreen} />
        <Stack.Screen name="PersonalityProfile" component={PersonalityProfileScreen} />
        <Stack.Screen
          name="PersonalityEnneagram"
          component={EnneagramScreen as never}
        />
        <Stack.Screen
          name="PersonalityNumerology"
          component={NumerologyScreen as never}
        />
        <Stack.Screen name="PersonalityTCM" component={TCMScreen as never} />
        <Stack.Screen name="PersonalityMBTI" component={MBTIScreen as never} />
        <Stack.Screen name="SearchChats" component={SearchChatsScreen} />
        <Stack.Screen name="VoiceNoteRecord" component={VoiceNoteRecordScreen} />
        <Stack.Screen name="VoiceNoteDetail" component={VoiceNoteDetailScreen} />
        <Stack.Screen name="PastReflections" component={PastReflectionsScreen} />
        <Stack.Screen name="YourJourney" component={YourJourneyScreen} />
        <Stack.Screen name="HearingDisclosure" component={HearingDisclosureScreen} />
        <Stack.Screen name="ListeningSession" component={ListeningSessionScreen} />
        <Stack.Screen name="SpeakerEnrollment" component={SpeakerEnrollmentScreen} />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="Profile">
          {(props) => (
            <ProfileScreen {...props} onStartOver={() => onStartOverRef.current()} />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
