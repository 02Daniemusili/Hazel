export type FormFieldKey = 'callerName' | 'phoneNumber' | 'category' | 'priority' | 'notes';

export type CallCategory = 'Inquiry' | 'Support' | 'Urgent' | 'Follow-Up' | 'Personal' | 'Spam';

export type PriorityLevel = 'Low' | 'Normal' | 'High';

export type GeminiVoiceName = 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';

export type CustomPhraseKey =
  | 'incoming_call'
  | 'moved_field'
  | 'cleared'
  | 'saved'
  | 'greeting';

export interface CustomPhraseClip {
  phraseKey: CustomPhraseKey;
  label: string;
  audioDataUrl: string;
  durationSec: number;
  updatedAt: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  ownerLabel: string;
  geminiVoiceName: GeminiVoiceName;
  stylePrompt: string;
  pitch: number;
  rate: number;
  warmthDb: number;
  sampleAudioDataUrl?: string;
  acousticSummary?: string;
  customClips: Partial<Record<CustomPhraseKey, CustomPhraseClip>>;
  isDefault?: boolean;
  updatedAt: string;
}

export interface CallIntakeForm {
  callerName: string;
  phoneNumber: string;
  category: CallCategory;
  priority: PriorityLevel;
  notes: string;
  lookupSource?: string;
  callerContext?: string;
}

export interface ContactRecord {
  id: string;
  name: string;
  phone: string;
  source: 'ContactsContract' | 'Cloud CRM';
  organization?: string;
  defaultCategory: CallCategory;
  notes?: string;
}

export interface CallLogEntry {
  id: string;
  callerName: string;
  phoneNumber: string;
  category: CallCategory;
  priority: PriorityLevel;
  notes: string;
  lookupSource: string;
  voiceProfileId: string;
  voiceProfileName: string;
  createdAt: string;
}

export type VoiceIntentType =
  | 'NEXT_FIELD'
  | 'PREV_FIELD'
  | 'GO_TO_FIELD'
  | 'SELECT_OPTION'
  | 'CLEAR_FIELD'
  | 'READ_BACK'
  | 'SUBMIT_FORM'
  | 'DICTATE'
  | 'STOP_LISTENING';

export interface IntentRouteResult {
  intent: VoiceIntentType;
  targetField?: FormFieldKey;
  optionValue?: string;
  dictationText?: string;
  spokenConfirmation: string;
  updates?: {
    callerName?: string;
    phoneNumber?: string;
    category?: CallCategory;
    priority?: PriorityLevel;
    notesAppend?: string;
  };
}

export interface AppStateResponse {
  contacts: ContactRecord[];
  callLogs: CallLogEntry[];
  voiceProfiles: VoiceProfile[];
  activeVoiceProfileId: string;
}
