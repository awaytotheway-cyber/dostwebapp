import type { LegalDocument } from './types';

/**
 * DRAFT terms and conditions, written on 2026-11-12. Not reviewed by a
 * lawyer. Square-bracketed text is for the owner to fill in.
 */
export const terms: LegalDocument = {
  title: 'Terms & Conditions',
  lastUpdated: 'Draft of 12 November 2026',
  isDraft: true,
  intro:
    'These terms are the agreement between you and DOST when you use the app. Please read them; by using DOST you accept them.',
  sections: [
    {
      heading: 'What DOST is',
      paragraphs: [
        'DOST is a companion for reflection. It is not a doctor, therapist or counsellor, and it does not give medical, psychological or legal advice, diagnose conditions or offer treatment.',
      ],
    },
    {
      heading: 'DOST is not an emergency service',
      paragraphs: [
        'If you are in danger, or thinking about harming yourself or someone else, please contact emergency services or someone you trust now.',
        'In India you can call Tele-MANAS on 14416, free and at any time, or 112 for emergencies. Elsewhere, please call your local emergency number.',
      ],
    },
    {
      heading: 'Who can use DOST',
      paragraphs: [
        'You must be at least [Minimum age — to be filled in] years old to use DOST.',
      ],
    },
    {
      heading: 'Your account',
      paragraphs: [
        'You sign in with Google. Keep your account secure; you are responsible for what happens under it.',
      ],
    },
    {
      heading: 'Using DOST well',
      paragraphs: [
        'Please don’t use DOST to break the law, to harm or harass anyone, to try to get into other people’s data, or to interfere with how the service runs.',
        'Listening sessions may pick up other people nearby. Only start one when you are comfortable with who is around you, and respect their privacy.',
      ],
    },
    {
      heading: 'About AI replies',
      paragraphs: [
        'DOST’s replies, labels and summaries are written by AI. They can be wrong, incomplete or miss what you meant. Please don’t rely on them for important decisions about your health, safety, money or relationships.',
      ],
    },
    {
      heading: 'Your content',
      paragraphs: [
        'What you write and record stays yours. You allow us to store and process it only to provide DOST to you, as described in the Privacy Policy.',
      ],
    },
    {
      heading: 'Ending',
      paragraphs: [
        'You can stop using DOST and delete your account at any time from your Profile. We may suspend accounts that misuse the service.',
      ],
    },
    {
      heading: 'Limits',
      paragraphs: [
        'DOST is provided as it is. [Limitation of liability and governing law — to be filled in after legal review.]',
      ],
    },
    {
      heading: 'Changes and contact',
      paragraphs: [
        'If these terms change, we’ll tell you in the app before the change applies. Questions: [Contact email — to be filled in].',
      ],
    },
  ],
};
