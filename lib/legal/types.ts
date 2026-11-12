/** A legal document as the app renders it. Pure data; no imports. */
export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

export type LegalDocument = {
  title: string;
  /** Shown as written; a draft says so. */
  lastUpdated: string;
  /** True until a lawyer has reviewed the text. Shows the draft banner. */
  isDraft: boolean;
  intro?: string;
  sections: LegalSection[];
};

export type LegalDocumentKey = 'privacy' | 'terms';
