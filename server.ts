import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AppStateResponse,
  CallCategory,
  CallLogEntry,
  ContactRecord,
  FormFieldKey,
  GeminiVoiceName,
  IntentRouteResult,
  PriorityLevel,
  VoiceProfile,
} from './src/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'hazel-store.json');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: 'v1beta',
  httpOptions: {
    apiVersion: 'v1beta',
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface StoreSchema extends AppStateResponse {}

const INITIAL_STORE: StoreSchema = {
  activeVoiceProfileId: 'hazel-default',
  voiceProfiles: [
    {
      id: 'hazel-default',
      name: 'Hazel',
      ownerLabel: 'Default AI Assistant · Warm & Articulate',
      geminiVoiceName: 'Kore',
      stylePrompt: 'Warm, calm, reassuring, and crisp personal call assistant named Hazel. Speak clearly at a natural conversational pace.',
      pitch: 1.02,
      rate: 1.0,
      warmthDb: 1.5,
      acousticSummary: 'Balanced mid-range warmth with clear consonant articulation for hands-free mobile readbacks.',
      customClips: {},
      isDefault: true,
      updatedAt: '2026-11-14T08:00:00.000Z',
    },
    {
      id: 'daughter-voice',
      name: "Daughter's Voice",
      ownerLabel: 'Family Voice Slot · Ready for Recording',
      geminiVoiceName: 'Zephyr',
      stylePrompt: 'Bright, affectionate, natural youthful female family voice. Cheerful, gentle, and reassuring when confirming call details.',
      pitch: 1.18,
      rate: 1.04,
      warmthDb: 2.0,
      acousticSummary: 'Preset ready for your daughter’s voice sample. Record or upload a 5–15 second clip to match her cadence and store custom voice confirmations.',
      customClips: {},
      isDefault: false,
      updatedAt: '2026-11-14T08:00:00.000Z',
    },
    {
      id: 'my-voice',
      name: 'My Voice',
      ownerLabel: 'Personal Voice Slot · Ready for Recording',
      geminiVoiceName: 'Charon',
      stylePrompt: 'Grounded, natural, direct personal voice. Concise and steady when reading back caller notes.',
      pitch: 0.94,
      rate: 0.98,
      warmthDb: 1.0,
      acousticSummary: 'Preset ready for your own voice sample. Record a quick sample so Hazel adapts to your personal speaking pace and tone.',
      customClips: {},
      isDefault: false,
      updatedAt: '2026-11-14T08:00:00.000Z',
    },
  ],
  contacts: [
    {
      id: 'c-1',
      name: 'Dr. Elena Rostova',
      phone: '+1 (415) 890-2314',
      source: 'ContactsContract',
      organization: 'Bayview Pediatrics',
      defaultCategory: 'Urgent',
      notes: 'Family pediatrician · direct clinic line',
    },
    {
      id: 'c-2',
      name: 'Marcus Vance',
      phone: '+1 (415) 602-8841',
      source: 'Cloud CRM',
      organization: 'Northstar Logistics',
      defaultCategory: 'Follow-Up',
      notes: 'Account lead · Tuesday shipment schedule',
    },
    {
      id: 'c-3',
      name: 'Maya Lin',
      phone: '+1 (650) 319-4407',
      source: 'ContactsContract',
      organization: 'Family',
      defaultCategory: 'Personal',
      notes: 'School pickup & weekend schedule',
    },
    {
      id: 'c-4',
      name: 'City Dental Care',
      phone: '+1 (415) 442-1900',
      source: 'Cloud CRM',
      organization: 'Healthcare Appointment Desk',
      defaultCategory: 'Inquiry',
      notes: 'Routine checkup confirmations',
    },
  ],
  callLogs: [
    {
      id: 'log-1',
      callerName: 'Dr. Elena Rostova',
      phoneNumber: '+1 (415) 890-2314',
      category: 'Urgent',
      priority: 'High',
      notes: 'Prescription ready at Oakridge Pharmacy before 6:00 PM; follow-up visit confirmed for Thursday at 10:30 AM.',
      lookupSource: 'ContactsContract',
      voiceProfileId: 'hazel-default',
      voiceProfileName: 'Hazel',
      createdAt: '2026-11-14T07:42:00.000Z',
    },
    {
      id: 'log-2',
      callerName: 'Marcus Vance',
      phoneNumber: '+1 (415) 602-8841',
      category: 'Follow-Up',
      priority: 'Normal',
      notes: 'Asked for updated warehouse dock code and revised invoice reference.',
      lookupSource: 'Cloud CRM',
      voiceProfileId: 'hazel-default',
      voiceProfileName: 'Hazel',
      createdAt: '2026-11-13T16:15:00.000Z',
    },
  ],
};

async function readStore(): Promise<StoreSchema> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoreSchema;
    if (!parsed.voiceProfiles?.length) {
      return INITIAL_STORE;
    }
    return parsed;
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(INITIAL_STORE, null, 2), 'utf8');
    return structuredClone(INITIAL_STORE);
  }
}

async function writeStore(store: StoreSchema): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

function deterministicRoute(
  transcript: string,
  currentField: FormFieldKey,
): IntentRouteResult | null {
  const raw = transcript.trim();
  const lower = raw.toLowerCase().replace(/^(hey |hi |ok |okay )?hazel[,:\s]*/i, '').trim();

  if (!lower) return null;

  if (/^(next|next field|move next|forward)$/.test(lower)) {
    return { intent: 'NEXT_FIELD', spokenConfirmation: 'Moved to next field.' };
  }
  if (/^(previous|prev|back|previous field|go back)$/.test(lower)) {
    return { intent: 'PREV_FIELD', spokenConfirmation: 'Moved to previous field.' };
  }
  if (/^(clear|clear field|erase|delete field|reset field)$/.test(lower)) {
    return { intent: 'CLEAR_FIELD', spokenConfirmation: 'Field cleared.' };
  }
  if (/^(read back|read|read form|verify|read entries)$/.test(lower)) {
    return { intent: 'READ_BACK', spokenConfirmation: 'Reading back your form.' };
  }
  if (/^(submit|submit form|save|save form|save call|done)$/.test(lower)) {
    return { intent: 'SUBMIT_FORM', spokenConfirmation: 'Saving call record.' };
  }
  if (/^(stop listening|stop|pause mic|mute)$/.test(lower)) {
    return { intent: 'STOP_LISTENING', spokenConfirmation: 'Microphone paused.' };
  }

  const goMatch = lower.match(/^(?:go to|focus|open|jump to|edit)\s+(.+)$/);
  if (goMatch) {
    const target = goMatch[1];
    if (target.includes('name')) {
      return { intent: 'GO_TO_FIELD', targetField: 'callerName', spokenConfirmation: 'Moved to Caller Name.' };
    }
    if (target.includes('phone') || target.includes('number')) {
      return { intent: 'GO_TO_FIELD', targetField: 'phoneNumber', spokenConfirmation: 'Moved to Phone Number.' };
    }
    if (target.includes('category') || target.includes('type')) {
      return { intent: 'GO_TO_FIELD', targetField: 'category', spokenConfirmation: 'Moved to Category.' };
    }
    if (target.includes('priority') || target.includes('level')) {
      return { intent: 'GO_TO_FIELD', targetField: 'priority', spokenConfirmation: 'Moved to Priority.' };
    }
    if (target.includes('note')) {
      return { intent: 'GO_TO_FIELD', targetField: 'notes', spokenConfirmation: 'Moved to Call Notes.' };
    }
  }

  const selectMatch = lower.match(/^(?:select|choose|set|mark as|set category to|set priority to)\s+(.+)$/);
  if (selectMatch) {
    const val = selectMatch[1];
    const categories: CallCategory[] = ['Inquiry', 'Support', 'Urgent', 'Follow-Up', 'Personal', 'Spam'];
    const priorities: PriorityLevel[] = ['Low', 'Normal', 'High'];
    const matchedCat = categories.find((c) => val.includes(c.toLowerCase().replace('-', ' ')) || val.includes(c.toLowerCase()));
    if (matchedCat) {
      return {
        intent: 'SELECT_OPTION',
        targetField: 'category',
        optionValue: matchedCat,
        spokenConfirmation: `Selected ${matchedCat} category.`,
      };
    }
    const matchedPri = priorities.find((p) => val.includes(p.toLowerCase()));
    if (matchedPri) {
      return {
        intent: 'SELECT_OPTION',
        targetField: 'priority',
        optionValue: matchedPri,
        spokenConfirmation: `Priority set to ${matchedPri}.`,
      };
    }
  }

  // Direct category/priority word when focused on that field
  if (currentField === 'category') {
    const categories: CallCategory[] = ['Inquiry', 'Support', 'Urgent', 'Follow-Up', 'Personal', 'Spam'];
    const matchedCat = categories.find((c) => lower === c.toLowerCase() || lower === c.toLowerCase().replace('-', ' '));
    if (matchedCat) {
      return {
        intent: 'SELECT_OPTION',
        targetField: 'category',
        optionValue: matchedCat,
        spokenConfirmation: `Selected ${matchedCat}.`,
      };
    }
  }

  if (currentField === 'priority') {
    const priorities: PriorityLevel[] = ['Low', 'Normal', 'High'];
    const matchedPri = priorities.find((p) => lower === p.toLowerCase());
    if (matchedPri) {
      return {
        intent: 'SELECT_OPTION',
        targetField: 'priority',
        optionValue: matchedPri,
        spokenConfirmation: `Set priority to ${matchedPri}.`,
      };
    }
  }

  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  app.get('/api/state', async (_req, res) => {
    const store = await readStore();
    res.json(store);
  });

  app.post('/api/caller-lookup', async (req, res) => {
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }

    const store = await readStore();
    const digits = normalizePhone(phoneNumber);
    const matched = store.contacts.find((c) => normalizePhone(c.phone) === digits && digits.length >= 7);

    if (matched) {
      return res.json({
        callerName: matched.name,
        phoneNumber: matched.phone,
        lookupSource: matched.source,
        callerContext: [matched.organization, matched.notes].filter(Boolean).join(' · '),
        suggestedCategory: matched.defaultCategory,
      });
    }

    // Unknown number: optionally use Gemini to infer region/spam likelihood cleanly
    if (process.env.GEMINI_API_KEY) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze this incoming caller phone number for a mobile CallScreeningService lookup: "${phoneNumber}". Return a concise caller identity guess or "Unknown Caller" and likely US/international area context without inventing fake personal names.`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                callerName: { type: Type.STRING },
                callerContext: { type: Type.STRING },
                suggestedCategory: { type: Type.STRING },
              },
              required: ['callerName', 'callerContext', 'suggestedCategory'],
            },
          },
        });
        const parsed = JSON.parse(response.text || '{}');
        const validCats: CallCategory[] = ['Inquiry', 'Support', 'Urgent', 'Follow-Up', 'Personal', 'Spam'];
        const suggestedCategory = validCats.includes(parsed.suggestedCategory)
          ? parsed.suggestedCategory
          : 'Inquiry';

        return res.json({
          callerName: parsed.callerName || 'Unknown Caller',
          phoneNumber,
          lookupSource: 'Cloud Caller ID',
          callerContext: parsed.callerContext || 'Unlisted incoming number · Ready for voice intake',
          suggestedCategory,
        });
      } catch (err) {
        console.error('Caller lookup AI fallback error:', err);
      }
    }

    return res.json({
      callerName: 'Unknown Caller',
      phoneNumber,
      lookupSource: 'Unlisted Number',
      callerContext: 'Not in ContactsContract or CRM · Ready for voice intake',
      suggestedCategory: 'Inquiry',
    });
  });

  app.post('/api/contacts', async (req, res) => {
    const { name, phone, source, organization, defaultCategory, notes } = req.body || {};
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required.' });
    }
    const store = await readStore();
    const newContact: ContactRecord = {
      id: `c-${Date.now()}`,
      name: String(name).trim(),
      phone: String(phone).trim(),
      source: source === 'Cloud CRM' ? 'Cloud CRM' : 'ContactsContract',
      organization: organization ? String(organization).trim() : undefined,
      defaultCategory: defaultCategory || 'Inquiry',
      notes: notes ? String(notes).trim() : undefined,
    };
    store.contacts.unshift(newContact);
    await writeStore(store);
    res.json({ contact: newContact, contacts: store.contacts });
  });

  app.delete('/api/contacts/:id', async (req, res) => {
    const store = await readStore();
    store.contacts = store.contacts.filter((c) => c.id !== req.params.id);
    await writeStore(store);
    res.json({ contacts: store.contacts });
  });

  app.post('/api/call-logs', async (req, res) => {
    const { callerName, phoneNumber, category, priority, notes, lookupSource } = req.body || {};
    if (!callerName && !phoneNumber) {
      return res.status(400).json({ error: 'Caller name or phone number is required.' });
    }
    const store = await readStore();
    const activeProfile =
      store.voiceProfiles.find((p) => p.id === store.activeVoiceProfileId) || store.voiceProfiles[0];

    const entry: CallLogEntry = {
      id: `log-${Date.now()}`,
      callerName: String(callerName || 'Unknown Caller').trim(),
      phoneNumber: String(phoneNumber || '').trim(),
      category: category || 'Inquiry',
      priority: priority || 'Normal',
      notes: String(notes || '').trim(),
      lookupSource: String(lookupSource || 'Manual Entry'),
      voiceProfileId: activeProfile.id,
      voiceProfileName: activeProfile.name,
      createdAt: new Date().toISOString(),
    };

    store.callLogs.unshift(entry);
    await writeStore(store);
    res.json({ entry, callLogs: store.callLogs });
  });

  app.put('/api/voice-profiles/active', async (req, res) => {
    const profileId = String(req.body?.profileId || '');
    const store = await readStore();
    const exists = store.voiceProfiles.some((p) => p.id === profileId);
    if (!exists) {
      return res.status(404).json({ error: 'Voice profile not found.' });
    }
    store.activeVoiceProfileId = profileId;
    await writeStore(store);
    res.json({ activeVoiceProfileId: store.activeVoiceProfileId });
  });

  app.post('/api/voice-profiles', async (req, res) => {
    const body = req.body as Partial<VoiceProfile>;
    if (!body.name) {
      return res.status(400).json({ error: 'Voice profile name is required.' });
    }
    const store = await readStore();
    const now = new Date().toISOString();
    const existingIdx = body.id ? store.voiceProfiles.findIndex((p) => p.id === body.id) : -1;

    if (existingIdx >= 0) {
      const prev = store.voiceProfiles[existingIdx];
      const updated: VoiceProfile = {
        ...prev,
        ...body,
        id: prev.id,
        customClips: body.customClips ?? prev.customClips,
        updatedAt: now,
      };
      store.voiceProfiles[existingIdx] = updated;
      await writeStore(store);
      return res.json({
        profile: updated,
        voiceProfiles: store.voiceProfiles,
        activeVoiceProfileId: store.activeVoiceProfileId,
      });
    }

    const created: VoiceProfile = {
      id: `voice-${Date.now()}`,
      name: body.name.trim(),
      ownerLabel: body.ownerLabel?.trim() || 'Custom Voice Profile',
      geminiVoiceName: (body.geminiVoiceName as GeminiVoiceName) || 'Zephyr',
      stylePrompt:
        body.stylePrompt?.trim() ||
        'Warm, natural, clear conversational voice assistant.',
      pitch: typeof body.pitch === 'number' ? body.pitch : 1.0,
      rate: typeof body.rate === 'number' ? body.rate : 1.0,
      warmthDb: typeof body.warmthDb === 'number' ? body.warmthDb : 1.5,
      sampleAudioDataUrl: body.sampleAudioDataUrl,
      acousticSummary: body.acousticSummary,
      customClips: body.customClips || {},
      isDefault: false,
      updatedAt: now,
    };

    store.voiceProfiles.push(created);
    await writeStore(store);
    return res.json({
      profile: created,
      voiceProfiles: store.voiceProfiles,
      activeVoiceProfileId: store.activeVoiceProfileId,
    });
  });

  app.delete('/api/voice-profiles/:id', async (req, res) => {
    const store = await readStore();
    const target = store.voiceProfiles.find((p) => p.id === req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'Voice profile not found.' });
    }
    if (target.isDefault) {
      return res.status(400).json({ error: 'Cannot delete the default Hazel profile.' });
    }
    store.voiceProfiles = store.voiceProfiles.filter((p) => p.id !== req.params.id);
    if (store.activeVoiceProfileId === req.params.id) {
      store.activeVoiceProfileId = store.voiceProfiles[0]?.id || 'hazel-default';
    }
    await writeStore(store);
    res.json({
      voiceProfiles: store.voiceProfiles,
      activeVoiceProfileId: store.activeVoiceProfileId,
    });
  });

  app.post('/api/voice-profiles/analyze-sample', async (req, res) => {
    const { audioBase64, mimeType, profileName } = req.body || {};
    if (!audioBase64 || !mimeType) {
      return res.status(400).json({ error: 'Audio sample data is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: String(mimeType),
                data: String(audioBase64),
              },
            },
            {
              text: `Listen closely to this voice sample intended for Hazel's custom voice profile named "${profileName || 'Custom Voice'}".
Analyze the speaker's vocal pitch register, warmth, pace, and expressive style.
Choose the closest matching prebuilt Gemini TTS voice from: Kore (warm, clear female), Zephyr (bright, youthful, airy female), Puck (energetic, expressive mid-high), Charon (grounded, steady mid-low), Fenrir (deep, resonant).
Also generate a vivid, actionable speechMetadata style prompt (max 30 words) and numeric pitch (0.8 to 1.35) and rate (0.85 to 1.15) approximations.`,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              acousticSummary: { type: Type.STRING },
              suggestedStylePrompt: { type: Type.STRING },
              recommendedGeminiVoice: { type: Type.STRING },
              recommendedPitch: { type: Type.NUMBER },
              recommendedRate: { type: Type.NUMBER },
            },
            required: [
              'acousticSummary',
              'suggestedStylePrompt',
              'recommendedGeminiVoice',
              'recommendedPitch',
              'recommendedRate',
            ],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      const allowedVoices: GeminiVoiceName[] = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'];
      const voice = allowedVoices.includes(parsed.recommendedGeminiVoice)
        ? parsed.recommendedGeminiVoice
        : 'Zephyr';

      res.json({
        acousticSummary: parsed.acousticSummary,
        suggestedStylePrompt: parsed.suggestedStylePrompt,
        recommendedGeminiVoice: voice,
        recommendedPitch: Math.min(1.4, Math.max(0.75, Number(parsed.recommendedPitch) || 1.0)),
        recommendedRate: Math.min(1.25, Math.max(0.8, Number(parsed.recommendedRate) || 1.0)),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to analyze voice sample';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/hazel/transcribe', async (req, res) => {
    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64 || !mimeType) {
      return res.status(400).json({ error: 'Audio payload is required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: String(mimeType),
                data: String(audioBase64),
              },
            },
            { text: 'Transcribe this spoken voice command or call note accurately. Return only the spoken text.' },
          ],
        },
      });
      res.json({ text: (response.text || '').trim() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transcription failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/hazel/route', async (req, res) => {
    const transcript = String(req.body?.transcript || '').trim();
    const currentField = (req.body?.currentField as FormFieldKey) || 'notes';
    const formState = req.body?.formState || {};

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required.' });
    }

    // Fast local deterministic routing for standard commands
    const fast = deterministicRoute(transcript, currentField);
    if (fast) {
      return res.json(fast);
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        intent: 'DICTATE',
        targetField: currentField,
        dictationText: transcript,
        spokenConfirmation: `Added to ${currentField}.`,
      } satisfies IntentRouteResult);
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `You are Hazel, a hands-free voice command router for a mobile caller-intake form.
Current focused field: "${currentField}".
Current form state: ${JSON.stringify(formState)}.
User spoke: "${transcript}".

Valid fields: callerName, phoneNumber, category, priority, notes.
Valid categories: Inquiry, Support, Urgent, Follow-Up, Personal, Spam.
Valid priorities: Low, Normal, High.

Classify into one primary intent:
- NEXT_FIELD
- PREV_FIELD
- GO_TO_FIELD (set targetField)
- SELECT_OPTION (set targetField to category or priority, and optionValue to exact valid option)
- CLEAR_FIELD
- READ_BACK
- SUBMIT_FORM
- STOP_LISTENING
- DICTATE (if dictating content for a field)

If the user gives a compound instruction (e.g. "Mark this urgent and say client called about invoice", or "Caller name is John Smith, priority high"), populate the "updates" object with every field mentioned (category, priority, callerName, phoneNumber, notesAppend) so nothing spoken is lost!
Provide a brief, friendly spokenConfirmation (max 10 words) in Hazel's voice.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: { type: Type.STRING },
              targetField: { type: Type.STRING },
              optionValue: { type: Type.STRING },
              dictationText: { type: Type.STRING },
              spokenConfirmation: { type: Type.STRING },
              updates: {
                type: Type.OBJECT,
                properties: {
                  callerName: { type: Type.STRING },
                  phoneNumber: { type: Type.STRING },
                  category: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  notesAppend: { type: Type.STRING },
                },
              },
            },
            required: ['intent', 'spokenConfirmation'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}') as IntentRouteResult;
      res.json(parsed);
    } catch {
      res.json({
        intent: 'DICTATE',
        targetField: currentField,
        dictationText: transcript,
        spokenConfirmation: 'Dictation recorded.',
      } satisfies IntentRouteResult);
    }
  });

  app.post('/api/hazel/speak', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const voiceProfileId = String(req.body?.voiceProfileId || '');
    const phraseKey = req.body?.phraseKey as string | undefined;
    const overrideProfile = req.body?.overrideProfile as Partial<VoiceProfile> | undefined;

    if (!text) {
      return res.status(400).json({ error: 'Text is required.' });
    }

    const store = await readStore();
    const savedProfile =
      store.voiceProfiles.find((p) => p.id === voiceProfileId) ||
      store.voiceProfiles.find((p) => p.id === store.activeVoiceProfileId) ||
      store.voiceProfiles[0];

    const profile: VoiceProfile = overrideProfile
      ? {
          ...savedProfile,
          ...overrideProfile,
          customClips: overrideProfile.customClips ?? savedProfile?.customClips ?? {},
        }
      : savedProfile;

    // If user recorded a real personal audio clip for this confirmation phrase, return it directly!
    if (
      !overrideProfile &&
      phraseKey &&
      profile?.customClips?.[phraseKey as keyof typeof profile.customClips]
    ) {
      const clip = profile.customClips[phraseKey as keyof typeof profile.customClips];
      if (clip?.audioDataUrl) {
        return res.json({
          mode: 'custom_clip',
          audioDataUrl: clip.audioDataUrl,
          profileName: profile.name,
        });
      }
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY not set; using browser voice fallback.',
        fallbackText: text,
        profile,
      });
    }

    try {
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text,
                  speechMetadata: {
                    style: profile.stylePrompt || 'Warm, calm, articulate assistant',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: profile.geminiVoiceName || 'Kore',
                },
              },
            },
          },
        });
      } catch (firstErr) {
        // Fallback: retry with style direction in text prompt if speechMetadata is rejected on current endpoint
        console.warn('Primary TTS call failed, retrying without speechMetadata:', firstErr);
        response = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: profile.stylePrompt
                    ? `Speak in this style (${profile.stylePrompt}): ${text}`
                    : text,
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: profile.geminiVoiceName || 'Kore',
                },
              },
            },
          },
        });
      }

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('No audio data returned from Gemini TTS.');
      }

      return res.json({
        mode: 'gemini_tts',
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
        profileName: profile.name,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'TTS generation failed';
      console.error('TTS error:', message);
      return res.status(502).json({ error: message, fallbackText: text, profile });
    }
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hazel server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
