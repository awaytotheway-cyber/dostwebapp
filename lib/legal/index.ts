import { privacyPolicy } from './privacyPolicy';
import { terms } from './terms';
import type { LegalDocument, LegalDocumentKey } from './types';

export type { LegalDocument, LegalDocumentKey, LegalSection } from './types';

export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  privacy: privacyPolicy,
  terms,
};
