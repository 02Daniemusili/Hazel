import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Mic,
  MicOff,
  PhoneIncoming,
  RotateCcw,
  Send,
  Sliders,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  CallCategory,
  CallIntakeForm,
  CustomPhraseKey,
  FormFieldKey,
  IntentRouteResult,
  PriorityLevel,
  VoiceProfile,
} from '../types';
import {
  blobToDataUrl,
  speakAsHazel,
  stopHazelSpeech,
  stripDataUrlPrefix,
} from '../utils/hazelAudio';

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}
interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const FIELD_ORDER: { key: FormFieldKey; indexLabel: string; label: string }[] = [
  { key: 'callerName', indexLabel: '01', label: 'Caller Name' },
  { key: 'phoneNumber', indexLabel: '02', label: 'Phone Number' },
  { key: 'category', indexLabel: '03', label: 'Call Category' },
  { key: 'priority', indexLabel: '04', label: 'Priority Level' },
  { key: 'notes', indexLabel: '05', label: 'Call Notes' },
];

const CATEGORIES: CallCategory[] = [
  'Inquiry',
  'Support',
  'Urgent',
  'Follow-Up',
  'Personal',
  'Spam',
];

const PRIORITIES: PriorityLevel[] = ['Low', 'Normal', 'High'];

interface InteractionEntry {
  id: string;
  heard: string;
  action: string;
  hazelReply: string;
  engine?: string;
}

interface VoiceFormWorkspaceProps {
  form: CallIntakeForm;
  setForm: React.Dispatch<React.SetStateAction<CallIntakeForm>>;
  voiceProfiles: VoiceProfile[];
  activeProfile: VoiceProfile;
  onSelectVoiceProfile: (id: string) => void;
  onOpenVoiceStudio: () => void;
  onOpenSimulateCall: () => void;
  onSubmitForm: (formToSave: CallIntakeForm) => Promise<void>;
  lastScreenedNotice?: string;
}

export function VoiceFormWorkspace({
  form,
  setForm,
  voiceProfiles,
  activeProfile,
  onSelectVoiceProfile,
  onOpenVoiceStudio,
  onOpenSimulateCall,
  onSubmitForm,
  lastScreenedNotice,
}: VoiceFormWorkspaceProps) {
  const [focusedField, setFocusedField] = useState<FormFieldKey>('notes');
  const [isListening, setIsListening] = useState(false);
  const [isRecordingPtt, setIsRecordingPtt] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [isRouting, setIsRouting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const [history, setHistory] = useState<InteractionEntry[]>([
    {
      id: 'init-1',
      heard: 'Ready for voice navigation',
      action: 'STANDBY',
      hazelReply: `Hazel is active using "${activeProfile.name}". Tap Start Listening or speak a command.`,
    },
  ]);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const keepListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const callerNameRef = useRef<HTMLInputElement | null>(null);
  const phoneNumberRef = useRef<HTMLInputElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  const formRef = useRef(form);
  formRef.current = form;
  const focusedFieldRef = useRef(focusedField);
  focusedFieldRef.current = focusedField;
  const activeProfileRef = useRef(activeProfile);
  activeProfileRef.current = activeProfile;

  const focusFieldProgrammatically = useCallback((field: FormFieldKey) => {
    setFocusedField(field);
    if (field === 'callerName') callerNameRef.current?.focus();
    if (field === 'phoneNumber') phoneNumberRef.current?.focus();
    if (field === 'notes') notesRef.current?.focus();
  }, []);

  const speakResponse = useCallback(
    async (text: string, phraseKey?: CustomPhraseKey): Promise<string> => {
      if (ttsMuted || !text) return 'muted';
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      try {
        const result = await speakAsHazel(text, activeProfileRef.current, phraseKey);
        return result.engine;
      } finally {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      }
    },
    [ttsMuted],
  );

  const buildReadBackText = (current: CallIntakeForm): string => {
    const caller = current.callerName || 'not entered';
    const phone = current.phoneNumber || 'not entered';
    const notes = current.notes || 'no notes recorded yet';
    return `Caller is ${caller}. Phone number ${phone}. Category is ${current.category}, priority ${current.priority}. Call notes: ${notes}.`;
  };

  const executeIntent = useCallback(
    async (heard: string, route: IntentRouteResult) => {
      const current = formRef.current;
      const currentField = focusedFieldRef.current;
      let reply = route.spokenConfirmation;
      let phraseKey: CustomPhraseKey | undefined;

      switch (route.intent) {
        case 'NEXT_FIELD': {
          const idx = FIELD_ORDER.findIndex((f) => f.key === currentField);
          const next = FIELD_ORDER[(idx + 1) % FIELD_ORDER.length];
          focusFieldProgrammatically(next.key);
          reply = `Moved to ${next.label}.`;
          phraseKey = 'moved_field';
          break;
        }
        case 'PREV_FIELD': {
          const idx = FIELD_ORDER.findIndex((f) => f.key === currentField);
          const prev = FIELD_ORDER[(idx - 1 + FIELD_ORDER.length) % FIELD_ORDER.length];
          focusFieldProgrammatically(prev.key);
          reply = `Moved back to ${prev.label}.`;
          phraseKey = 'moved_field';
          break;
        }
        case 'GO_TO_FIELD': {
          const target = route.targetField || 'notes';
          const meta = FIELD_ORDER.find((f) => f.key === target) || FIELD_ORDER[4];
          focusFieldProgrammatically(meta.key);
          reply = `Moved to ${meta.label}.`;
          phraseKey = 'moved_field';
          break;
        }
        case 'SELECT_OPTION': {
          if (
            route.targetField === 'category' &&
            route.optionValue &&
            CATEGORIES.includes(route.optionValue as CallCategory)
          ) {
            setForm((prev) => ({ ...prev, category: route.optionValue as CallCategory }));
            setFocusedField('category');
          } else if (
            route.targetField === 'priority' &&
            route.optionValue &&
            PRIORITIES.includes(route.optionValue as PriorityLevel)
          ) {
            setForm((prev) => ({ ...prev, priority: route.optionValue as PriorityLevel }));
            setFocusedField('priority');
          }
          break;
        }
        case 'CLEAR_FIELD': {
          setForm((prev) => {
            if (currentField === 'callerName') return { ...prev, callerName: '' };
            if (currentField === 'phoneNumber') return { ...prev, phoneNumber: '' };
            if (currentField === 'notes') return { ...prev, notes: '' };
            if (currentField === 'category') return { ...prev, category: 'Inquiry' };
            if (currentField === 'priority') return { ...prev, priority: 'Normal' };
            return prev;
          });
          phraseKey = 'cleared';
          break;
        }
        case 'READ_BACK': {
          reply = buildReadBackText(current);
          break;
        }
        case 'SUBMIT_FORM': {
          await onSubmitForm(current);
          phraseKey = 'saved';
          reply = `Call record for ${current.callerName || 'caller'} saved.`;
          break;
        }
        case 'STOP_LISTENING': {
          keepListeningRef.current = false;
          recognitionRef.current?.stop();
          setIsListening(false);
          break;
        }
        case 'DICTATE': {
          const target = route.targetField || currentField;
          const textToInsert = (route.dictationText || heard).trim();
          if (target === 'callerName') {
            setForm((prev) => ({ ...prev, callerName: textToInsert }));
          } else if (target === 'phoneNumber') {
            setForm((prev) => ({ ...prev, phoneNumber: textToInsert }));
          } else if (target === 'notes') {
            setForm((prev) => ({
              ...prev,
              notes: prev.notes ? `${prev.notes.trim()} ${textToInsert}` : textToInsert,
            }));
          } else {
            // If focused on category/priority, place freeform dictation into notes cleanly
            setForm((prev) => ({
              ...prev,
              notes: prev.notes ? `${prev.notes.trim()} ${textToInsert}` : textToInsert,
            }));
          }
          break;
        }
      }

      if (route.updates) {
        const u = route.updates;
        setForm((prev) => ({
          ...prev,
          callerName: u.callerName ? u.callerName.trim() : prev.callerName,
          phoneNumber: u.phoneNumber ? u.phoneNumber.trim() : prev.phoneNumber,
          category:
            u.category && CATEGORIES.includes(u.category) ? u.category : prev.category,
          priority:
            u.priority && PRIORITIES.includes(u.priority) ? u.priority : prev.priority,
          notes: u.notesAppend
            ? prev.notes
              ? `${prev.notes.trim()} ${u.notesAppend.trim()}`
              : u.notesAppend.trim()
            : prev.notes,
        }));
      }

      const engineUsed = await speakResponse(reply, phraseKey);

      setHistory((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          heard,
          action: route.intent,
          hazelReply: reply,
          engine: engineUsed,
        },
        ...prev.slice(0, 7),
      ]);
    },
    [focusFieldProgrammatically, onSubmitForm, setForm, speakResponse],
  );

  const handleTranscript = useCallback(
    async (transcript: string) => {
      const cleaned = transcript.trim();
      if (!cleaned) return;
      setIsRouting(true);
      setStatusNotice('');
      try {
        const res = await fetch('/api/hazel/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: cleaned,
            currentField: focusedFieldRef.current,
            formState: formRef.current,
          }),
        });
        const route: IntentRouteResult = await res.json();
        await executeIntent(cleaned, route);
      } catch {
        setStatusNotice('Could not route voice input. Check connection.');
      } finally {
        setIsRouting(false);
      }
    },
    [executeIntent],
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      keepListeningRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.stop();
      stopHazelSpeech();
    };
  }, []);

  const toggleContinuousMic = () => {
    if (isListening) {
      keepListeningRef.current = false;
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      recognitionRef.current?.stop();
      setIsListening(false);
      setInterimText('');
      return;
    }

    const Win = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const SpeechRec = Win.SpeechRecognition || Win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setStatusNotice(
        'Continuous Web Speech API is unavailable in this browser. Use "Record Clip" below for Gemini transcription.',
      );
      return;
    }

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      if (isSpeakingRef.current) return;
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        } else {
          interimChunk += result[0].transcript;
        }
      }
      setInterimText(interimChunk);
      if (finalChunk.trim()) {
        setInterimText('');
        handleTranscript(finalChunk);
      }
    };

    recognition.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        keepListeningRef.current = false;
        setIsListening(false);
        setStatusNotice('Microphone permission was denied. Allow mic access or use the command bar.');
      }
    };

    recognition.onend = () => {
      if (keepListeningRef.current) {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (!keepListeningRef.current) return;
          try {
            recognition.start();
          } catch {
            setIsListening(false);
            keepListeningRef.current = false;
          }
        }, 250);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    setStatusNotice('');
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      keepListeningRef.current = false;
    }
  };

  const toggleAudioPtt = async () => {
    if (isRecordingPtt && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingPtt(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 256) {
          setStatusNotice('Recording was too short. Hold and speak for at least 1 second.');
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        const { mimeType, base64 } = stripDataUrlPrefix(dataUrl);
        setIsRouting(true);
        try {
          const trRes = await fetch('/api/hazel/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: base64, mimeType }),
          });
          const trData = await trRes.json();
          if (trData.text) {
            await handleTranscript(trData.text);
          } else {
            setStatusNotice(trData.error || 'No speech detected in clip.');
          }
        } catch {
          setStatusNotice('Audio transcription failed.');
        } finally {
          setIsRouting(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecordingPtt(true);
      setStatusNotice('');
    } catch {
      setStatusNotice('Microphone access unavailable. Use the quick command input below.');
    }
  };

  const currentFieldIndex = FIELD_ORDER.findIndex((f) => f.key === focusedField);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Column: Caller ID Banner + Indexed Voice Form */}
      <div className="lg:col-span-7 xl:col-span-8 space-y-5">
        {/* Screened Caller Context Card */}
        <section className="bg-white rounded-2xl border border-[#E5E1D8] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-[#5C5852]">
                <span>Module A · Caller Identification</span>
                <span aria-hidden="true">·</span>
                <span>{form.lookupSource || 'Awaiting incoming call'}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-semibold text-[#181715]">
                {form.callerName ? form.callerName : 'Incoming Call Intake Form'}
              </h1>
              <p className="text-sm text-[#5C5852]">
                {lastScreenedNotice ||
                  form.callerContext ||
                  'Simulate an incoming call to auto-identify the caller, or speak to navigate and fill fields.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenSimulateCall}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-sm font-medium text-[#181715] flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <PhoneIncoming className="w-4 h-4 text-[#2F4F3E]" />
              Screen Call
            </button>
          </div>
        </section>

        {/* Indexed Voice Form */}
        <section className="bg-white rounded-2xl border border-[#E5E1D8] overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-[#E5E1D8] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#181715]">
                Module B · Voice-Navigated Form
              </h2>
              <p className="text-xs text-[#5C5852] mt-0.5 tabular-nums">
                Active Focus: {FIELD_ORDER[currentFieldIndex]?.indexLabel}.{' '}
                {FIELD_ORDER[currentFieldIndex]?.label}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleTranscript('Previous')}
                className="min-h-[40px] min-w-[40px] px-3 py-1.5 rounded-lg border border-[#E5E1D8] text-xs font-medium text-[#181715] hover:bg-[#F8F7F4] flex items-center gap-1 transition-colors"
                title="Previous field"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Prev
              </button>
              <button
                type="button"
                onClick={() => handleTranscript('Next')}
                className="min-h-[40px] min-w-[40px] px-3 py-1.5 rounded-lg border border-[#E5E1D8] text-xs font-medium text-[#181715] hover:bg-[#F8F7F4] flex items-center gap-1 transition-colors"
                title="Next field"
              >
                Next
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleTranscript('Read back')}
                className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#E5E1D8] text-xs font-medium text-[#181715] hover:bg-[#F8F7F4] flex items-center gap-1.5 transition-colors"
              >
                <Volume2 className="w-3.5 h-3.5 text-[#2F4F3E]" />
                Read Back
              </button>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 01 Caller Name */}
              <div
                onClick={() => focusFieldProgrammatically('callerName')}
                className={`p-3.5 rounded-xl border transition-colors ${
                  focusedField === 'callerName'
                    ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.03]'
                    : 'border-[#E5E1D8] bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="field-caller-name"
                    className="text-xs font-medium text-[#5C5852]"
                  >
                    <span className="font-mono text-[#9A6B2F] mr-1.5">01</span>
                    Caller Name
                  </label>
                  {focusedField === 'callerName' && (
                    <span className="text-[11px] font-medium text-[#2F4F3E]">Focused</span>
                  )}
                </div>
                <input
                  id="field-caller-name"
                  ref={callerNameRef}
                  type="text"
                  value={form.callerName}
                  onFocus={() => setFocusedField('callerName')}
                  onChange={(e) => setForm((p) => ({ ...p, callerName: e.target.value }))}
                  placeholder="Auto-filled or dictate name..."
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] focus:outline-none focus:border-[#2F4F3E]"
                />
              </div>

              {/* 02 Phone Number */}
              <div
                onClick={() => focusFieldProgrammatically('phoneNumber')}
                className={`p-3.5 rounded-xl border transition-colors ${
                  focusedField === 'phoneNumber'
                    ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.03]'
                    : 'border-[#E5E1D8] bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="field-phone-number"
                    className="text-xs font-medium text-[#5C5852]"
                  >
                    <span className="font-mono text-[#9A6B2F] mr-1.5">02</span>
                    Phone Number
                  </label>
                  {focusedField === 'phoneNumber' && (
                    <span className="text-[11px] font-medium text-[#2F4F3E]">Focused</span>
                  )}
                </div>
                <input
                  id="field-phone-number"
                  ref={phoneNumberRef}
                  type="tel"
                  value={form.phoneNumber}
                  onFocus={() => setFocusedField('phoneNumber')}
                  onChange={(e) => setForm((p) => ({ ...p, phoneNumber: e.target.value }))}
                  placeholder="+1 (000) 000-0000"
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-[#E5E1D8] bg-[#F8F7F4] font-mono text-sm text-[#181715] tabular-nums focus:outline-none focus:border-[#2F4F3E]"
                />
              </div>
            </div>

            {/* 03 Category */}
            <div
              onClick={() => setFocusedField('category')}
              className={`p-3.5 rounded-xl border transition-colors ${
                focusedField === 'category'
                  ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.03]'
                  : 'border-[#E5E1D8] bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#5C5852]">
                  <span className="font-mono text-[#9A6B2F] mr-1.5">03</span>
                  Call Category
                </span>
                {focusedField === 'category' && (
                  <span className="text-[11px] font-medium text-[#2F4F3E]">
                    Say “Select [Option]”
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {CATEGORIES.map((cat) => {
                  const active = form.category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusedField('category');
                        setForm((p) => ({ ...p, category: cat }));
                      }}
                      className={`min-h-[44px] px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#2F4F3E] text-white border-[#2F4F3E]'
                          : 'bg-[#F8F7F4] text-[#181715] border-[#E5E1D8] hover:bg-[#F1EFEA]'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 04 Priority */}
            <div
              onClick={() => setFocusedField('priority')}
              className={`p-3.5 rounded-xl border transition-colors ${
                focusedField === 'priority'
                  ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.03]'
                  : 'border-[#E5E1D8] bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#5C5852]">
                  <span className="font-mono text-[#9A6B2F] mr-1.5">04</span>
                  Priority Level
                </span>
                {focusedField === 'priority' && (
                  <span className="text-[11px] font-medium text-[#2F4F3E]">Focused</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {PRIORITIES.map((pri) => {
                  const active = form.priority === pri;
                  return (
                    <button
                      key={pri}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusedField('priority');
                        setForm((p) => ({ ...p, priority: pri }));
                      }}
                      className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#181715] text-white border-[#181715]'
                          : 'bg-[#F8F7F4] text-[#181715] border-[#E5E1D8] hover:bg-[#F1EFEA]'
                      }`}
                    >
                      {pri}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 05 Call Notes */}
            <div
              onClick={() => focusFieldProgrammatically('notes')}
              className={`p-3.5 rounded-xl border transition-colors ${
                focusedField === 'notes'
                  ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.03]'
                  : 'border-[#E5E1D8] bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="field-call-notes" className="text-xs font-medium text-[#5C5852]">
                  <span className="font-mono text-[#9A6B2F] mr-1.5">05</span>
                  Call Notes (Dictation Target)
                </label>
                <div className="flex items-center gap-3">
                  {focusedField === 'notes' && (
                    <span className="text-[11px] font-medium text-[#2F4F3E]">Focused</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setForm((p) => ({ ...p, notes: '' }));
                    }}
                    className="text-xs text-[#5C5852] hover:text-[#181715] flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Clear
                  </button>
                </div>
              </div>
              <textarea
                id="field-call-notes"
                ref={notesRef}
                rows={3}
                value={form.notes}
                onFocus={() => setFocusedField('notes')}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Speak naturally to dictate call notes, or say 'Clear field', 'Read back', 'Submit form'..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] leading-relaxed focus:outline-none focus:border-[#2F4F3E]"
              />
            </div>

            {/* Voice Control & Dictation Dock */}
            <div className="pt-2 border-t border-[#E5E1D8] space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={toggleContinuousMic}
                  className={`min-h-[48px] px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                    isListening
                      ? 'bg-[#9E2A2B] text-white'
                      : 'bg-[#2F4F3E] text-white hover:bg-[#243E30]'
                  }`}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {isListening ? 'Stop Listening' : 'Start Listening'}
                </button>

                <button
                  type="button"
                  onClick={toggleAudioPtt}
                  className={`min-h-[48px] px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2 transition-colors whitespace-nowrap ${
                    isRecordingPtt
                      ? 'bg-[#9A6B2F] text-white border-[#9A6B2F]'
                      : 'bg-[#F8F7F4] text-[#181715] border-[#E5E1D8] hover:bg-[#F1EFEA]'
                  }`}
                >
                  {isRecordingPtt ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Stop & Transcribe
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-[#9A6B2F]" />
                      Record Clip
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setTtsMuted((m) => !m)}
                  className="min-h-[48px] min-w-[48px] px-3 py-2.5 rounded-xl border border-[#E5E1D8] bg-white hover:bg-[#F8F7F4] text-xs font-medium text-[#5C5852] flex items-center gap-1.5 transition-colors"
                  title={ttsMuted ? 'Unmute Hazel voice' : 'Mute Hazel voice'}
                >
                  {ttsMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  <span className="hidden sm:inline">{ttsMuted ? 'Muted' : 'Voice On'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTranscript('Submit form')}
                  className="ml-auto min-h-[48px] px-5 py-2.5 rounded-xl bg-[#181715] text-white text-sm font-medium hover:bg-[#2F2D29] flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Check className="w-4 h-4" />
                  Save Call
                </button>
              </div>

              {(interimText || isRouting || statusNotice) && (
                <div className="text-xs px-3.5 py-2 rounded-lg bg-[#F8F7F4] border border-[#E5E1D8] text-[#5C5852]">
                  {interimText && (
                    <span className="text-[#181715]">Hearing: “{interimText}”</span>
                  )}
                  {isRouting && !interimText && <span>Hazel is routing your command...</span>}
                  {statusNotice && !isRouting && <span className="text-[#9E2A2B]">{statusNotice}</span>}
                </div>
              )}

              {/* Text / Quick Command Fallback Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!commandInput.trim()) return;
                  const cmd = commandInput;
                  setCommandInput('');
                  handleTranscript(cmd);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder='Type a voice command or dictation (e.g. "Go to Notes" or "Follow up tomorrow")...'
                  className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] focus:outline-none focus:border-[#2F4F3E]"
                />
                <button
                  type="submit"
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E5E1D8] bg-white hover:bg-[#F1EFEA] text-sm font-medium text-[#181715] flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>

      {/* Side Column: Active Hazel Voice Switcher + Live Transcript + Command Guide */}
      <aside className="lg:col-span-5 xl:col-span-4 space-y-5">
        {/* Active Voice Profile Card */}
        <section className="bg-white rounded-2xl border border-[#E5E1D8] p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-[#5C5852]">Active Responsive Voice</p>
              <h2 className="text-lg font-semibold text-[#181715] mt-0.5">
                {activeProfile.name}
              </h2>
              <p className="text-xs text-[#5C5852] mt-0.5">{activeProfile.ownerLabel}</p>
            </div>
            <button
              type="button"
              onClick={onOpenVoiceStudio}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] flex items-center gap-1.5 transition-colors shrink-0"
            >
              <Sliders className="w-3.5 h-3.5 text-[#2F4F3E]" />
              Customize
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="quick-voice-switch" className="block text-xs font-medium text-[#5C5852]">
              Switch Hazel’s Voice Profile
            </label>
            <div className="grid grid-cols-1 gap-2">
              {voiceProfiles.map((profile) => {
                const isSelected = profile.id === activeProfile.id;
                const clipCount = Object.keys(profile.customClips || {}).length;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => onSelectVoiceProfile(profile.id)}
                    className={`min-h-[48px] px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.05]'
                        : 'border-[#E5E1D8] bg-white hover:bg-[#F8F7F4]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#181715] truncate">{profile.name}</p>
                      <p className="text-xs text-[#5C5852] truncate">
                        Base: {profile.geminiVoiceName}
                        {clipCount > 0 ? ` · ${clipCount} recorded clips` : ''}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-[#2F4F3E] shrink-0">
                      {isSelected ? 'Active' : 'Use'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              speakResponse(
                `Hello, this is Hazel speaking in ${activeProfile.name}. Ready for your next call.`,
                'greeting',
              )
            }
            disabled={isSpeaking}
            className="w-full min-h-[44px] px-4 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] flex items-center justify-center gap-2 transition-colors"
          >
            <Volume2 className="w-4 h-4 text-[#2F4F3E]" />
            {isSpeaking ? 'Speaking...' : `Test ${activeProfile.name}`}
          </button>
        </section>

        {/* Live Voice Interaction Log */}
        <section className="bg-white rounded-2xl border border-[#E5E1D8] p-5 space-y-3">
          <h3 className="text-sm font-semibold text-[#181715]">Hazel Activity Feed</h3>
          <div className="divide-y divide-[#E5E1D8] max-h-[260px] overflow-y-auto pr-1">
            {history.map((item) => (
              <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#5C5852]">
                  <span className="font-mono">{item.action}</span>
                  {item.engine && item.engine !== 'muted' && (
                    <span>
                      {item.engine === 'custom_clip'
                        ? 'Recorded Clip'
                        : item.engine === 'gemini_tts'
                          ? 'Hazel TTS'
                          : 'Device Voice'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#5C5852]">You: “{item.heard}”</p>
                <p className="text-xs font-medium text-[#181715]">Hazel: “{item.hazelReply}”</p>
              </div>
            ))}
          </div>
        </section>

        {/* Voice Command Cheat Sheet */}
        <section className="bg-white rounded-2xl border border-[#E5E1D8] p-5 space-y-3">
          <h3 className="text-sm font-semibold text-[#181715]">Hands-Free Voice Commands</h3>
          <div className="divide-y divide-[#E5E1D8] text-xs">
            {[
              { cmd: '“Next” / “Previous”', desc: 'Move focus between form fields' },
              { cmd: '“Go to Notes” / “Caller Name”', desc: 'Jump directly to any field' },
              { cmd: '“Select Urgent” / “Set High”', desc: 'Choose category or priority' },
              { cmd: '“Clear field”', desc: 'Empty the focused input' },
              { cmd: '“Read back”', desc: 'Hazel reads entries aloud' },
              { cmd: '“Submit form” / “Save”', desc: 'Validate and save call record' },
            ].map((row) => (
              <button
                key={row.cmd}
                type="button"
                onClick={() => {
                  const sample = row.cmd.split('/')[0].replace(/[“”"]/g, '').trim();
                  handleTranscript(sample);
                }}
                className="w-full py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[#F8F7F4] rounded px-1 transition-colors"
              >
                <span className="font-medium text-[#2F4F3E]">{row.cmd}</span>
                <span className="text-[#5C5852] text-right">{row.desc}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
