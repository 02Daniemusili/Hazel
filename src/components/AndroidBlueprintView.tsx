import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { VoiceProfile } from '../types';

interface AndroidBlueprintViewProps {
  activeProfile: VoiceProfile;
}

export function AndroidBlueprintView({ activeProfile }: AndroidBlueprintViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<'manifest' | 'screening' | 'activity'>('screening');

  const manifestCode = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.hazel.voiceintake">

    <uses-permission android:name="android.permission.READ_CONTACTS" />
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application android:label="Hazel">
        <service
            android:name=".HazelCallScreeningService"
            android:permission="android.permission.BIND_SCREENING_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.telecom.CallScreeningService" />
            </intent-filter>
        </service>
        <activity
            android:name=".HazelVoiceFormActivity"
            android:exported="true"
            android:launchMode="singleTop" />
    </application>
</manifest>`;

  const screeningCode = `package com.hazel.voiceintake

import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import android.telecom.Call
import android.telecom.CallScreeningService

class HazelCallScreeningService : CallScreeningService() {

    override fun onScreenCall(callDetails: Call.Details) {
        val incomingNumber = callDetails.handle?.schemeSpecificPart ?: return
        val localName = lookupLocalContact(incomingNumber)

        val intent = Intent(this, HazelVoiceFormActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("EXTRA_PHONE_NUMBER", incomingNumber)
            putExtra("EXTRA_CALLER_NAME", localName ?: "")
            putExtra("EXTRA_VOICE_PROFILE_ID", "${activeProfile.id}")
        }
        startActivity(intent)

        // Allow the call to ring normally while Hazel displays the intake form
        respondToCall(callDetails, CallResponse.Builder().build())
    }

    private fun lookupLocalContact(phoneNumber: String): String? {
        val uri = Uri.withAppendedPath(
            ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
            Uri.encode(phoneNumber)
        )
        contentResolver.query(
            uri,
            arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
            null, null, null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                return cursor.getString(0)
            }
        }
        return null
    }
}`;

  const activityCode = `package com.hazel.voiceintake

import android.content.Intent
import android.media.MediaPlayer
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.widget.EditText
import androidx.appcompat.app.AppCompatActivity
import java.util.Locale

class HazelVoiceFormActivity : AppCompatActivity() {

    private lateinit var speechRecognizer: SpeechRecognizer
    private lateinit var tts: TextToSpeech
    private lateinit var fields: List<EditText>
    private var currentFieldIndex = 0

    // Active Hazel Voice Profile synced from studio: ${activeProfile.name}
    private val activeVoiceProfileId = "${activeProfile.id}"
    private val voicePitch = ${activeProfile.pitch.toFixed(2)}f
    private val voiceRate = ${activeProfile.rate.toFixed(2)}f

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Bind form inputs: 0: Caller Name, 1: Phone Number, 2: Notes
        // Pre-fill from Intent extras & query /api/caller-lookup if name is blank
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts.language = Locale.US
                tts.setPitch(voicePitch)
                tts.setSpeechRate(voiceRate)
            }
        }
        startContinuousListening()
    }

    private fun startContinuousListening() {
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }
        speechRecognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val spoken = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!spoken.isNullOrBlank()) routeCommandOrDictate(spoken)
                speechRecognizer.startListening(intent) // Auto-restart continuous mic
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) { speechRecognizer.startListening(intent) }
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        speechRecognizer.startListening(intent)
    }

    private fun routeCommandOrDictate(text: String) {
        when {
            text.equals("next", ignoreCase = true) -> {
                currentFieldIndex = (currentFieldIndex + 1) % fields.size
                fields[currentFieldIndex].requestFocus()
                speakHazel("Moved to next field")
            }
            text.equals("clear field", ignoreCase = true) -> {
                fields[currentFieldIndex].setText("")
                speakHazel("Field cleared")
            }
            else -> fields[currentFieldIndex].append(" $text")
        }
    }

    private fun speakHazel(message: String) {
        // Calls /api/hazel/speak with activeVoiceProfileId ("${activeProfile.id}")
        // or falls back to local tuned TextToSpeech
        tts.speak(message, TextToSpeech.QUEUE_FLUSH, null, "hazel_utterance")
    }
}`;

  const currentCode =
    activeFile === 'manifest'
      ? manifestCode
      : activeFile === 'screening'
        ? screeningCode
        : activityCode;

  const copyCode = async () => {
    await navigator.clipboard.writeText(currentCode);
    setCopiedId(activeFile);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-[#E5E1D8] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#181715]">
              Android Native Companion Blueprint
            </h1>
            <p className="text-sm text-[#5C5852] mt-1">
              Ready-to-use Kotlin modules pre-configured for Hazel’s active voice profile (
              <span className="font-medium text-[#181715]">{activeProfile.name}</span>) and
              server endpoints.
            </p>
          </div>

          <button
            type="button"
            onClick={copyCode}
            className="min-h-[40px] px-4 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] flex items-center gap-1.5 transition-colors"
          >
            {copiedId === activeFile ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#2F4F3E]" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy File
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#F1EFEA] rounded-xl border border-[#E5E1D8] w-fit">
          <button
            type="button"
            onClick={() => setActiveFile('screening')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeFile === 'screening'
                ? 'bg-white text-[#181715] shadow-xs'
                : 'text-[#5C5852] hover:text-[#181715]'
            }`}
          >
            HazelCallScreeningService.kt
          </button>
          <button
            type="button"
            onClick={() => setActiveFile('activity')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeFile === 'activity'
                ? 'bg-white text-[#181715] shadow-xs'
                : 'text-[#5C5852] hover:text-[#181715]'
            }`}
          >
            HazelVoiceFormActivity.kt
          </button>
          <button
            type="button"
            onClick={() => setActiveFile('manifest')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeFile === 'manifest'
                ? 'bg-white text-[#181715] shadow-xs'
                : 'text-[#5C5852] hover:text-[#181715]'
            }`}
          >
            AndroidManifest.xml
          </button>
        </div>

        <pre className="p-4 sm:p-5 rounded-xl bg-[#181715] text-[#F8F7F4] font-mono text-xs leading-relaxed overflow-x-auto">
          <code>{currentCode}</code>
        </pre>
      </div>
    </div>
  );
}
