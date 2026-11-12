import type { LegalDocument } from './types';

/**
 * DRAFT privacy policy, written on 2026-11-12 from what the code and the
 * production project actually do. It has not been reviewed by a lawyer.
 * Square-bracketed text is for the owner to fill in, never invented.
 *
 * When the app's data handling changes, this text must change with it.
 * lib/legal/legal_test.ts checks the promises it makes.
 */
export const privacyPolicy: LegalDocument = {
  title: 'Privacy Policy',
  lastUpdated: 'Draft of 12 November 2026',
  isDraft: true,
  intro:
    'DOST is a quiet companion for reflecting on how you feel. This explains what DOST keeps, why, who helps us run it, and the choices you have. We do not sell your data and we do not use it for advertising.',
  sections: [
    {
      heading: 'Who we are',
      paragraphs: [
        'DOST is provided by [Legal name of the provider — to be filled in]. You can reach us at [Contact email — to be filled in].',
      ],
    },
    {
      heading: 'What DOST keeps',
      paragraphs: [
        'Your account: when you sign in with Google, we receive your name, email address and a Google account identifier.',
        'Your profile: the name you choose, your date and place of birth, your intentions, your reminder time, and your answers to the personality questions (such as dosha, MBTI, Enneagram, numerology and TCM).',
        'Your conversations: the messages you write, DOST’s replies, and the feeling and need labels DOST draws from your messages. DOST also keeps a short summary of what it has learned about you (its “memory”), a longer understanding written overnight from your recent conversations, reflections for the Your Patterns screen, and daily summaries of how each day seemed from your own messages.',
        'Voice notes: the transcript of each voice note, DOST’s reply and the feeling labels drawn from it. The recording itself may also be kept, in a private storage area that only your account can reach, so that you can play it back. Deleting a voice note deletes its recording.',
      ],
    },
    {
      heading: 'Listening sessions',
      paragraphs: [
        'Listening sessions are optional and you start and stop each one yourself. While a session runs, your phone shows that DOST is listening.',
        'Listening audio is never saved. It exists only in your phone’s memory for a few seconds while it is processed, and is then discarded.',
        'Before anything else, DOST checks that the voice is yours, using a voice profile you record when you set up listening. Speech that doesn’t match is dropped straight away.',
        'Your speech is turned into text on your phone. If you choose cloud transcription in Settings, clips of your own voice are sent to OpenAI for transcription instead.',
        'To notice feelings, the text of what you said is sent to OpenAI with phone numbers, email addresses and street addresses removed first. Names are not removed. Only feeling labels and simple measurements such as pace and energy are kept, never the words or the audio.',
      ],
    },
    {
      heading: 'What stays on your phone',
      paragraphs: [
        'On-device transcription, the neural voice profile used to recognise you, and the app’s own diagnostic notes stay on your phone and are not sent to us. The speech models are downloaded to your phone from Hugging Face and GitHub; that download sends no personal data.',
      ],
    },
    {
      heading: 'How we use it',
      paragraphs: [
        'To reply to you in conversation, to remember what matters to you between conversations, to show you your own patterns over time, to send the reminders you ask for, and to keep the service working and secure. We don’t use your data to train AI models, and we don’t share it for marketing.',
      ],
    },
    {
      heading: 'Who helps us run DOST',
      paragraphs: [
        'Supabase stores your data, handles sign-in and runs DOST’s server functions.',
        'OpenAI writes DOST’s replies and reads your messages and voice notes to label feelings, to transcribe voice notes (and listening clips, if you chose cloud transcription), and to write the reflections and daily summaries on Your Patterns.',
        'Groq writes the overnight understanding of your recent conversations.',
        'Google provides sign-in. Vercel hosts the web version of DOST.',
        'These providers process data on our behalf to run DOST. [Confirm each provider’s data-processing terms and where the data is stored — to be filled in after legal review.]',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'We keep your data until you delete it or delete your account. [Backup retention period — to be filled in.]',
      ],
    },
    {
      heading: 'Your choices',
      paragraphs: [
        'Export: from your Profile you can download a copy of your conversations, profile, intentions, DOST’s memory of you and your daily summaries.',
        'Delete: you can delete all your conversations (which also deletes the feeling labels and daily summaries drawn from them), your listening data, your voice profile, or your whole account. Deleting your account removes everything DOST keeps about you.',
        'You can stop using listening, voice notes or reminders at any time.',
      ],
    },
    {
      heading: 'Keeping it safe',
      paragraphs: [
        'Your data travels encrypted, and the database only lets your account read your own records.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: [
        'DOST is not meant for anyone under [Minimum age — to be filled in].',
      ],
    },
    {
      heading: 'Changes to this policy',
      paragraphs: [
        'If we change how DOST handles your data, we’ll update this policy and tell you in the app before the change applies.',
      ],
    },
  ],
};
