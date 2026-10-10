import type { ConversationStage } from '../lib/emotionalStates';

export type ChatStackParamList = {
  Home: undefined;
  Chat:
    | {
        reflectionOpening?: boolean;
        conversationsCleared?: boolean;
        focusMessageId?: string;
        focusCreatedAt?: string;
        newChat?: boolean;
        newSession?: boolean;
        /** Seed chat with a voice-note transcript (+ optional DOST reply) after newSession. */
        voiceNoteContinue?: {
          transcript: string;
          dostResponse?: string | null;
          /** Auto-send after seeding (chip picked on VoiceNoteDetail). */
          autoChipMessage?: {
            text: string;
            selected_emotion?: string;
            selected_need?: string;
          };
        };
      }
    | undefined;
  Settings: undefined;
  PersonalityProfile: undefined;
  PersonalityEnneagram: { standalone: true };
  PersonalityNumerology: { standalone: true; dob: string };
  PersonalityTCM: { standalone: true };
  PersonalityMBTI: { standalone: true };
  Reflection: { mode?: 'prompt' | 'noticings' } | undefined;
  DoshaRetake: undefined;
  SearchChats: undefined;
  VoiceNoteRecord: undefined;
  VoiceNoteDetail:
    | {
        id: string;
        transcript?: string;
        dost_response?: string | null;
        primary_emotion?: string | null;
        secondary_emotions?: string[] | null;
        underlying_need?: string | null;
        duration_seconds?: number;
        audio_storage_path?: string | null;
        created_at?: string;
      }
    | undefined;
  PastReflections: undefined;
  YourJourney: undefined;
  Profile: undefined;
  HearingDisclosure: { returnTo?: 'ListeningSession' } | undefined;
  ListeningSession: undefined;
  SpeakerEnrollment: { returnTo?: 'ListeningSession' } | undefined;
  ThreeVoices: undefined;
};

/** Chat edge function success payload (Step 7 — UI wired in Step 8). */
export type ChatApiResponse = {
  reply: string;
  suggested_emotions: string[];
  suggested_needs: string[];
  conversation_stage: ConversationStage;
};
