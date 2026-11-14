import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Mic,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type {
  CustomPhraseClip,
  CustomPhraseKey,
  GeminiVoiceName,
  VoiceProfile,
} from '../types';
import {
  blobToDataUrl,
  speakAsHazel,
  stopHazelSpeech,
  stripDataUrlPrefix,
} from '../utils/hazelAudio';

const GEMINI_VOICES: { id: GeminiVoiceName; label: string; tone: string }[] = [
  { id: 'Kore', label: 'Kore', tone: 'Warm, clear & calm' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Bright, light & youthful' },
  { id: 'Puck', label: 'Puck', tone: 'Expressive & lively' },
  { id: 'Charon', label: 'Charon', tone: 'Grounded & steady' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Deep & resonant' },
];

const PHRASE_SLOTS: { key: CustomPhraseKey; label: string; prompt: string }[] = [
  {
    key: 'greeting',
    label: 'Greeting',
    prompt: '“Hi, this is Hazel. Ready for your call.”',
  },
  {
    key: 'incoming_call',
    label: 'Incoming Call',
    prompt: '“Incoming call identified and pre-filled.”',
  },
  {
    key: 'moved_field',
    label: 'Field Navigation',
    prompt: '“Moved to the next field.”',
  },
  {
    key: 'cleared',
    label: 'Field Cleared',
    prompt: '“Field cleared.”',
  },
  {
    key: 'saved',
    label: 'Form Saved',
    prompt: '“Call form saved.”',
  },
];

interface VoiceStudioProps {
  profiles: VoiceProfile[];
  activeProfileId: string;
  onSelectActive: (id: string) => Promise<void>;
  onSaveProfile: (profile: Partial<VoiceProfile>) => Promise<VoiceProfile>;
  onDeleteProfile: (id: string) => Promise<void>;
}

export function VoiceStudio({
  profiles,
  activeProfileId,
  onSelectActive,
  onSaveProfile,
  onDeleteProfile,
}: VoiceStudioProps) {
  const [selectedId, setSelectedId] = useState<string>(activeProfileId);
  const [draft, setDraft] = useState<VoiceProfile | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const [isRecordingSample, setIsRecordingSample] = useState(false);
  const [sampleElapsed, setSampleElapsed] = useState(0);
  const [recordingPhraseKey, setRecordingPhraseKey] = useState<CustomPhraseKey | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [auditionText, setAuditionText] = useState(
    'Hello, this is Hazel. Incoming call from Dr. Elena Rostova has been logged and saved.',
  );
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isCreatingNew) return;
    const found = profiles.find((p) => p.id === selectedId) || profiles[0];
    if (found) setDraft(structuredClone(found));
  }, [profiles, selectedId, isCreatingNew]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      stopHazelSpeech();
    };
  }, []);

  const startNewProfile = () => {
    setIsCreatingNew(true);
    setFeedback(null);
    setDraft({
      id: '',
      name: 'New Family Voice',
      ownerLabel: 'Custom Voice Profile',
      geminiVoiceName: 'Zephyr',
      stylePrompt: 'Warm, gentle, natural conversational voice.',
      pitch: 1.05,
      rate: 1.0,
      warmthDb: 1.5,
      customClips: {},
      isDefault: false,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRecordSample = async () => {
    if (isRecordingSample && recorderRef.current) {
      recorderRef.current.stop();
      setIsRecordingSample(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 256) {
          setFeedback({
            type: 'err',
            text: 'Recording was too short. Please speak for at least 2 seconds.',
          });
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        setDraft((prev) => (prev ? { ...prev, sampleAudioDataUrl: dataUrl } : prev));
        setFeedback({
          type: 'ok',
          text: 'Voice sample captured. Click “Analyze & Match with AI” to tune Hazel.',
        });
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setSampleElapsed(0);
      setIsRecordingSample(true);
      setFeedback(null);
      timerRef.current = window.setInterval(() => {
        setSampleElapsed((s) => s + 1);
      }, 1000);
    } catch {
      setFeedback({
        type: 'err',
        text: 'Microphone access was blocked. You can still upload an audio recording file.',
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setFeedback({ type: 'err', text: 'Please select an audio file under 8 MB.' });
      return;
    }
    const dataUrl = await blobToDataUrl(file);
    setDraft((prev) => (prev ? { ...prev, sampleAudioDataUrl: dataUrl } : prev));
    setFeedback({
      type: 'ok',
      text: `Loaded “${file.name}”. Click “Analyze & Match with AI” to adapt Hazel’s voice.`,
    });
    e.target.value = '';
  };

  const handleAnalyzeSample = async () => {
    if (!draft?.sampleAudioDataUrl) return;
    setIsAnalyzing(true);
    setFeedback(null);
    try {
      const { mimeType, base64 } = stripDataUrlPrefix(draft.sampleAudioDataUrl);
      const res = await fetch('/api/voice-profiles/analyze-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType,
          profileName: draft.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');

      setDraft((prev) =>
        prev
          ? {
              ...prev,
              geminiVoiceName: data.recommendedGeminiVoice || prev.geminiVoiceName,
              stylePrompt: data.suggestedStylePrompt || prev.stylePrompt,
              acousticSummary: data.acousticSummary || prev.acousticSummary,
              pitch: data.recommendedPitch ?? prev.pitch,
              rate: data.recommendedRate ?? prev.rate,
            }
          : prev,
      );
      setFeedback({
        type: 'ok',
        text: 'AI analyzed the voice sample and updated Hazel’s voice persona, pitch, and cadence.',
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to analyze sample.',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRecordPhraseClip = async (phraseKey: CustomPhraseKey, label: string) => {
    if (recordingPhraseKey === phraseKey && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingPhraseKey(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const startedAt = Date.now();
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 256) {
          setFeedback({
            type: 'err',
            text: 'Clip was too short. Please record for at least 1 second.',
          });
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const clip: CustomPhraseClip = {
          phraseKey,
          label,
          audioDataUrl: dataUrl,
          durationSec,
          updatedAt: new Date().toISOString(),
        };
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                customClips: {
                  ...prev.customClips,
                  [phraseKey]: clip,
                },
              }
            : prev,
        );
        setFeedback({
          type: 'ok',
          text: `Saved real voice clip for “${label}”. Click Save Changes to keep it.`,
        });
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecordingPhraseKey(phraseKey);
      setFeedback(null);
    } catch {
      setFeedback({
        type: 'err',
        text: 'Microphone permission required to record a confirmation phrase.',
      });
    }
  };

  const handleSave = async (activateAfter = false) => {
    if (!draft || !draft.name.trim()) {
      setFeedback({ type: 'err', text: 'Profile name is required.' });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const saved = await onSaveProfile(draft);
      setIsCreatingNew(false);
      setSelectedId(saved.id);
      if (activateAfter) {
        await onSelectActive(saved.id);
        setFeedback({ type: 'ok', text: `Saved and activated “${saved.name}” for Hazel.` });
      } else {
        setFeedback({ type: 'ok', text: `Saved changes to “${saved.name}”.` });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save voice profile.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAudition = async () => {
    if (!draft) return;
    setIsAuditioning(true);
    try {
      const res = await speakAsHazel(auditionText, draft, undefined, draft);
      setFeedback({
        type: 'ok',
        text: `Auditioned “${draft.name}” via ${
          res.engine === 'gemini_tts' ? 'Gemini TTS' : 'Browser Voice'
        }.`,
      });
    } finally {
      setIsAuditioning(false);
    }
  };

  if (!draft) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Voice Profile Roster */}
      <aside className="lg:col-span-4 space-y-4">
        <section className="bg-white rounded-2xl border border-[#E5E1D8] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-[#181715]">Hazel Voice Profiles</h1>
              <p className="text-xs text-[#5C5852] mt-0.5">
                Swap or update voices anytime — yours, your daughter’s, or future voices.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {profiles.map((profile) => {
              const isSelected = !isCreatingNew && draft.id === profile.id;
              const isActive = activeProfileId === profile.id;
              const clipCount = Object.keys(profile.customClips || {}).length;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => {
                    setIsCreatingNew(false);
                    setSelectedId(profile.id);
                    setFeedback(null);
                  }}
                  className={`w-full min-h-[60px] p-3.5 rounded-xl border text-left transition-colors flex items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.05]'
                      : 'border-[#E5E1D8] bg-white hover:bg-[#F8F7F4]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#181715] truncate">{profile.name}</p>
                    <p className="text-xs text-[#5C5852] truncate mt-0.5">
                      {profile.geminiVoiceName} · {clipCount} clips
                      {profile.sampleAudioDataUrl ? ' · Sample saved' : ''}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium shrink-0 ${
                      isActive ? 'text-[#2F4F3E]' : 'text-[#5C5852]'
                    }`}
                  >
                    {isActive ? 'Active' : 'Edit'}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={startNewProfile}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-dashed border-[#C7C1B5] hover:border-[#2F4F3E] bg-[#F8F7F4] text-sm font-medium text-[#181715] flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4 text-[#2F4F3E]" />
            Add Future Voice Profile
          </button>
        </section>
      </aside>

      {/* Main Column: Editor, Sample Capture, Custom Clips & Live Audition */}
      <div className="lg:col-span-8 space-y-5">
        <section className="bg-white rounded-2xl border border-[#E5E1D8] p-5 sm:p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E5E1D8] pb-4">
            <div>
              <p className="text-xs text-[#5C5852]">
                {isCreatingNew ? 'New Voice Profile' : 'Editing Voice Profile'}
              </p>
              <h2 className="text-xl font-semibold text-[#181715] mt-0.5">
                {draft.name || 'Untitled Voice'}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isCreatingNew && !draft.isDefault && (
                <button
                  type="button"
                  onClick={async () => {
                    await onDeleteProfile(draft.id);
                    setSelectedId(profiles[0]?.id || 'hazel-default');
                  }}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-[#E5E1D8] text-xs font-medium text-[#9E2A2B] hover:bg-[#9E2A2B]/5 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={isSaving}
                className="min-h-[40px] px-4 py-1.5 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={isSaving}
                className="min-h-[40px] px-4 py-1.5 rounded-xl bg-[#2F4F3E] hover:bg-[#243E30] text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Save & Set Active
              </button>
            </div>
          </div>

          {feedback && (
            <div
              className={`px-4 py-3 rounded-xl border text-xs ${
                feedback.type === 'ok'
                  ? 'bg-[#2F4F3E]/[0.06] border-[#2F4F3E]/30 text-[#181715]'
                  : 'bg-[#9E2A2B]/[0.06] border-[#9E2A2B]/30 text-[#9E2A2B]'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* Profile Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="vp-name" className="block text-xs font-medium text-[#5C5852]">
                Voice Profile Name
              </label>
              <input
                id="vp-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g., Daughter's Voice, My Voice"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] focus:outline-none focus:border-[#2F4F3E]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="vp-owner" className="block text-xs font-medium text-[#5C5852]">
                Relationship / Voice Note
              </label>
              <input
                id="vp-owner"
                type="text"
                value={draft.ownerLabel}
                onChange={(e) => setDraft({ ...draft, ownerLabel: e.target.value })}
                placeholder="e.g., Family Voice · Recorded Nov 2026"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] focus:outline-none focus:border-[#2F4F3E]"
              />
            </div>
          </div>

          {/* Step 1: Capture or Upload Real Voice Sample */}
          <div className="p-4 sm:p-5 rounded-xl bg-[#F8F7F4] border border-[#E5E1D8] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#181715]">
                  01. Record or Upload Target Voice Sample
                </h3>
                <p className="text-xs text-[#5C5852] mt-0.5">
                  Record 5–15 seconds of your daughter’s voice or your own voice (or upload a recording). Gemini analyzes the audio to match Hazel’s tone and cadence.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleRecordSample}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-colors ${
                  isRecordingSample
                    ? 'bg-[#9E2A2B] text-white'
                    : 'bg-[#181715] text-white hover:bg-[#2E2C28]'
                }`}
              >
                {isRecordingSample ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop Recording ({sampleElapsed}s)
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    Record Voice Sample
                  </>
                )}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E5E1D8] bg-white hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] flex items-center gap-2 transition-colors"
              >
                <Upload className="w-4 h-4 text-[#5C5852]" />
                Upload Audio File
              </button>

              {draft.sampleAudioDataUrl && (
                <button
                  type="button"
                  onClick={handleAnalyzeSample}
                  disabled={isAnalyzing}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#2F4F3E] hover:bg-[#243E30] text-xs font-medium text-white flex items-center gap-2 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  {isAnalyzing ? 'Analyzing Voice...' : 'Analyze & Match with AI'}
                </button>
              )}
            </div>

            {draft.sampleAudioDataUrl && (
              <div className="pt-2 space-y-2">
                <audio controls src={draft.sampleAudioDataUrl} className="w-full h-10" />
                {draft.acousticSummary && (
                  <p className="text-xs text-[#5C5852] leading-relaxed">
                    <span className="font-medium text-[#181715]">Acoustic Profile: </span>
                    {draft.acousticSummary}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Gemini Voice Design & Acoustic Tuning */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#181715]">
              02. Voice Synthesis Base & Acoustic Tuning
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {GEMINI_VOICES.map((v) => {
                const selected = draft.geminiVoiceName === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setDraft({ ...draft, geminiVoiceName: v.id })}
                    className={`min-h-[56px] p-2.5 rounded-xl border text-left transition-colors ${
                      selected
                        ? 'border-[#2F4F3E] bg-[#2F4F3E]/[0.06]'
                        : 'border-[#E5E1D8] bg-white hover:bg-[#F8F7F4]'
                    }`}
                  >
                    <p className="text-xs font-semibold text-[#181715]">{v.label}</p>
                    <p className="text-[11px] text-[#5C5852] mt-0.5 leading-tight">{v.tone}</p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="vp-style" className="block text-xs font-medium text-[#5C5852]">
                Voice Persona & Delivery Direction
              </label>
              <textarea
                id="vp-style"
                rows={2}
                value={draft.stylePrompt}
                onChange={(e) => setDraft({ ...draft, stylePrompt: e.target.value })}
                placeholder="Describe tone, warmth, age register, and pacing..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] focus:outline-none focus:border-[#2F4F3E]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-3.5 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#5C5852]">Pitch Register</span>
                  <span className="font-mono text-[#181715] tabular-nums">
                    {draft.pitch.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.7}
                  max={1.45}
                  step={0.02}
                  value={draft.pitch}
                  onChange={(e) => setDraft({ ...draft, pitch: parseFloat(e.target.value) })}
                  className="w-full accent-[#2F4F3E]"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#5C5852]">Speaking Rate</span>
                  <span className="font-mono text-[#181715] tabular-nums">
                    {draft.rate.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.75}
                  max={1.3}
                  step={0.02}
                  value={draft.rate}
                  onChange={(e) => setDraft({ ...draft, rate: parseFloat(e.target.value) })}
                  className="w-full accent-[#2F4F3E]"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#5C5852]">Vocal Warmth</span>
                  <span className="font-mono text-[#181715] tabular-nums">
                    {draft.warmthDb >= 0 ? `+${draft.warmthDb}` : draft.warmthDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-4}
                  max={6}
                  step={0.5}
                  value={draft.warmthDb}
                  onChange={(e) => setDraft({ ...draft, warmthDb: parseFloat(e.target.value) })}
                  className="w-full accent-[#2F4F3E]"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Custom Personal Confirmation Clips */}
          <div className="space-y-3 pt-2 border-t border-[#E5E1D8]">
            <div>
              <h3 className="text-sm font-semibold text-[#181715]">
                03. Personal Spoken Confirmation Clips (Optional)
              </h3>
              <p className="text-xs text-[#5C5852] mt-0.5">
                Record short phrases directly in your daughter’s or your own real voice. Hazel plays these authentic clips whenever those actions happen.
              </p>
            </div>

            <div className="divide-y divide-[#E5E1D8] border border-[#E5E1D8] rounded-xl overflow-hidden">
              {PHRASE_SLOTS.map((slot) => {
                const existing = draft.customClips?.[slot.key];
                const isRec = recordingPhraseKey === slot.key;
                return (
                  <div
                    key={slot.key}
                    className="px-4 py-3 bg-white flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#181715]">{slot.label}</p>
                      <p className="text-xs text-[#5C5852]">{slot.prompt}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {existing && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const audio = new Audio(existing.audioDataUrl);
                              audio.play().catch(() => {});
                            }}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E5E1D8] bg-[#F8F7F4] text-xs font-medium text-[#181715] flex items-center gap-1"
                          >
                            <Play className="w-3.5 h-3.5 text-[#2F4F3E]" />
                            Play ({existing.durationSec}s)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextClips = { ...draft.customClips };
                              delete nextClips[slot.key];
                              setDraft({ ...draft, customClips: nextClips });
                            }}
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#E5E1D8] text-[#9E2A2B] hover:bg-[#9E2A2B]/5"
                            aria-label={`Remove ${slot.label} clip`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleRecordPhraseClip(slot.key, slot.label)}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                          isRec
                            ? 'bg-[#9E2A2B] text-white'
                            : 'border border-[#E5E1D8] bg-white hover:bg-[#F8F7F4] text-[#181715]'
                        }`}
                      >
                        {isRec ? (
                          <>
                            <Square className="w-3 h-3 fill-current" />
                            Stop
                          </>
                        ) : (
                          <>
                            <Mic className="w-3.5 h-3.5 text-[#2F4F3E]" />
                            {existing ? 'Re-record' : 'Record'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Audition Bar */}
          <div className="pt-4 border-t border-[#E5E1D8] space-y-2">
            <label htmlFor="vp-audition" className="block text-xs font-medium text-[#5C5852]">
              Live Voice Audition
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="vp-audition"
                type="text"
                value={auditionText}
                onChange={(e) => setAuditionText(e.target.value)}
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm text-[#181715] focus:outline-none focus:border-[#2F4F3E]"
              />
              <button
                type="button"
                onClick={handleAudition}
                disabled={isAuditioning}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#181715] text-white text-sm font-medium hover:bg-[#2F2D29] flex items-center justify-center gap-2 transition-colors shrink-0"
              >
                <Volume2 className="w-4 h-4" />
                {isAuditioning ? 'Speaking...' : 'Audition Voice'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
