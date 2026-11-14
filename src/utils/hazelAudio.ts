import type { CustomPhraseKey, VoiceProfile } from '../types';

let sharedAudioCtx: AudioContext | null = null;
let currentSourceNode: AudioBufferSourceNode | null = null;
let currentHtmlAudio: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function stopHazelSpeech(): void {
  if (currentSourceNode) {
    try {
      currentSourceNode.stop();
    } catch {
      // already stopped
    }
    currentSourceNode = null;
  }
  if (currentHtmlAudio) {
    currentHtmlAudio.pause();
    currentHtmlAudio.currentTime = 0;
    currentHtmlAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

async function playBufferWithProfile(
  arrayBuffer: ArrayBuffer,
  profile: VoiceProfile,
): Promise<void> {
  const ctx = getAudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.playbackRate.value = Math.min(1.4, Math.max(0.7, profile.rate || 1.0));

  const warmthFilter = ctx.createBiquadFilter();
  warmthFilter.type = 'lowshelf';
  warmthFilter.frequency.value = 260;
  warmthFilter.gain.value = profile.warmthDb ?? 1.0;

  source.connect(warmthFilter);
  warmthFilter.connect(ctx.destination);

  currentSourceNode = source;
  return new Promise((resolve) => {
    source.onended = () => {
      if (currentSourceNode === source) currentSourceNode = null;
      resolve();
    };
    source.start(0);
  });
}

function playDataUrlAudio(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(dataUrl);
    currentHtmlAudio = audio;
    audio.onended = () => {
      if (currentHtmlAudio === audio) currentHtmlAudio = null;
      resolve(true);
    };
    audio.onerror = () => {
      if (currentHtmlAudio === audio) currentHtmlAudio = null;
      resolve(false);
    };
    audio.play().catch(() => {
      if (currentHtmlAudio === audio) currentHtmlAudio = null;
      resolve(false);
    });
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function speakWithBrowserFallback(text: string, profile: VoiceProfile): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = Math.min(1.8, Math.max(0.5, profile.pitch || 1.0));
    utterance.rate = Math.min(1.5, Math.max(0.65, profile.rate || 1.0));

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const preferFemale =
        profile.geminiVoiceName === 'Kore' ||
        profile.geminiVoiceName === 'Zephyr' ||
        profile.geminiVoiceName === 'Puck';
      const match =
        voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (preferFemale
              ? /samantha|victoria|karen|zira|aria|google us english|female/i.test(v.name)
              : /daniel|alex|david|guy|male/i.test(v.name)),
        ) || voices.find((v) => v.lang.startsWith('en'));
      if (match) utterance.voice = match;
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export async function speakAsHazel(
  text: string,
  profile: VoiceProfile,
  phraseKey?: CustomPhraseKey,
  overrideProfile?: Partial<VoiceProfile>,
): Promise<{ engine: 'custom_clip' | 'gemini_tts' | 'browser_tts' }> {
  stopHazelSpeech();

  // Check client-side custom recorded clip immediately for zero-latency playback
  if (!overrideProfile && phraseKey && profile.customClips?.[phraseKey]?.audioDataUrl) {
    const clipUrl = profile.customClips[phraseKey]!.audioDataUrl;
    const played = await playDataUrlAudio(clipUrl);
    if (played) {
      return { engine: 'custom_clip' };
    }
  }

  try {
    const res = await fetch('/api/hazel/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceProfileId: profile.id,
        phraseKey,
        overrideProfile,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.mode === 'custom_clip' && data.audioDataUrl) {
        const played = await playDataUrlAudio(data.audioDataUrl);
        if (played) return { engine: 'custom_clip' };
      }

      if (data.mode === 'gemini_tts' && data.audioBase64) {
        try {
          const buffer = base64ToArrayBuffer(data.audioBase64);
          await playBufferWithProfile(buffer, profile);
          return { engine: 'gemini_tts' };
        } catch {
          // If Web Audio decoding fails (e.g. autoplay lock), try HTML Audio directly before browser TTS
          const played = await playDataUrlAudio(`data:audio/wav;base64,${data.audioBase64}`);
          if (played) return { engine: 'gemini_tts' };
        }
      }
    }
  } catch {
    // Fall through cleanly to browser synthesis
  }

  await speakWithBrowserFallback(text, profile);
  return { engine: 'browser_tts' };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function stripDataUrlPrefix(dataUrl: string): { mimeType: string; base64: string } {
  const commaIdx = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || commaIdx === -1) {
    return { mimeType: 'audio/webm', base64: dataUrl };
  }
  const header = dataUrl.slice(5, commaIdx);
  const mimeType = header.split(';')[0] || 'audio/webm';
  const base64 = dataUrl.slice(commaIdx + 1);
  return { mimeType, base64 };
}
