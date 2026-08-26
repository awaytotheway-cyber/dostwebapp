export type ChatStackParamList = {
  Chat: { reflectionOpening?: boolean; conversationsCleared?: boolean } | undefined;
  Settings: undefined;
  Reflection: { mode?: 'prompt' | 'noticings' } | undefined;
  DoshaRetake: undefined;
};
