import React, { useCallback, useEffect, useRef } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from './ChatScreen';
import SettingsScreen from './SettingsScreen';
import ReflectionScreen from './ReflectionScreen';
import DoshaRetakeScreen from './DoshaRetakeScreen';
import type { ChatStackParamList } from './chatTypes';
import {
  initNotificationRouting,
  restoreEveningScheduleIfAllowed,
  subscribeReflectionNav,
} from '../lib/notifications';

const Stack = createNativeStackNavigator<ChatStackParamList>();
const navigationRef = createNavigationContainerRef<ChatStackParamList>();

type Props = {
  onStartOver: () => void;
};

export default function ChatNavigator({ onStartOver }: Props) {
  const onStartOverRef = useRef(onStartOver);
  onStartOverRef.current = onStartOver;
  const pendingReflection = useRef(false);

  const openReflection = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Reflection', { mode: 'prompt' });
      return;
    }
    pendingReflection.current = true;
  }, []);

  useEffect(() => {
    initNotificationRouting();
    const unsub = subscribeReflectionNav(() => {
      openReflection();
    });
    void restoreEveningScheduleIfAllowed();
    return unsub;
  }, [openReflection]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (pendingReflection.current) {
          pendingReflection.current = false;
          navigationRef.navigate('Reflection', { mode: 'prompt' });
        }
      }}
    >
      <Stack.Navigator
        initialRouteName="Chat"
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
