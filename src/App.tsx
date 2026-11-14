/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { Code2, History, Mic, PhoneIncoming, Sliders } from 'lucide-react';
import type {
  AppStateResponse,
  CallCategory,
  CallIntakeForm,
  CallLogEntry,
  ContactRecord,
  VoiceProfile,
} from './types';
import { VoiceFormWorkspace } from './components/VoiceFormWorkspace';
import { VoiceStudio } from './components/VoiceStudio';
import { CallLogAndDirectory } from './components/CallLogAndDirectory';
import { AndroidBlueprintView } from './components/AndroidBlueprintView';
import { IncomingCallModal } from './components/IncomingCallModal';
import { speakAsHazel } from './utils/hazelAudio';

type AppTab = 'form' | 'voices' | 'logs' | 'android';

const EMPTY_FORM: CallIntakeForm = {
  callerName: '',
  phoneNumber: '',
  category: 'Inquiry',
  priority: 'Normal',
  notes: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('form');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([]);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [activeVoiceProfileId, setActiveVoiceProfileId] = useState<string>('hazel-default');
  const [form, setForm] = useState<CallIntakeForm>(EMPTY_FORM);
  const [isSimulateModalOpen, setIsSimulateModalOpen] = useState(false);
  const [lastScreenedNotice, setLastScreenedNotice] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? '' : prev));
    }, 3500);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('Failed to load Hazel workspace.');
        const data: AppStateResponse = await res.json();
        if (!active) return;
        setContacts(data.contacts || []);
        setCallLogs(data.callLogs || []);
        setVoiceProfiles(data.voiceProfiles || []);
        setActiveVoiceProfileId(data.activeVoiceProfileId || 'hazel-default');
      } catch (err: unknown) {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to reach server.');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const activeProfile: VoiceProfile =
    voiceProfiles.find((p) => p.id === activeVoiceProfileId) ||
    voiceProfiles[0] || {
      id: 'hazel-default',
      name: 'Hazel',
      ownerLabel: 'Default AI Assistant',
      geminiVoiceName: 'Kore',
      stylePrompt: 'Warm, calm, articulate assistant.',
      pitch: 1.0,
      rate: 1.0,
      warmthDb: 1.5,
      customClips: {},
      updatedAt: '',
    };

  const handleSelectActiveVoice = async (id: string) => {
    setActiveVoiceProfileId(id);
    const chosen = voiceProfiles.find((p) => p.id === id);
    await fetch('/api/voice-profiles/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: id }),
    });
    if (chosen) {
      showToast(`Hazel voice switched to ${chosen.name}`);
    }
  };

  const handleSaveProfile = async (profile: Partial<VoiceProfile>): Promise<VoiceProfile> => {
    const res = await fetch('/api/voice-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save profile.');
    setVoiceProfiles(data.voiceProfiles);
    return data.profile;
  };

  const handleDeleteProfile = async (id: string) => {
    const res = await fetch(`/api/voice-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed.');
    setVoiceProfiles(data.voiceProfiles);
    setActiveVoiceProfileId(data.activeVoiceProfileId);
    showToast('Voice profile removed.');
  };

  const handleCallerResolved = async (payload: {
    callerName: string;
    phoneNumber: string;
    lookupSource: string;
    callerContext: string;
    suggestedCategory: CallCategory;
  }) => {
    setForm({
      callerName: payload.callerName,
      phoneNumber: payload.phoneNumber,
      category: payload.suggestedCategory,
      priority: payload.suggestedCategory === 'Urgent' ? 'High' : 'Normal',
      notes: '',
      lookupSource: payload.lookupSource,
      callerContext: payload.callerContext,
    });
    setLastScreenedNotice(
      `Screened via ${payload.lookupSource}${payload.callerContext ? ` · ${payload.callerContext}` : ''}`,
    );
    setActiveTab('form');
    await speakAsHazel(
      `Incoming call from ${payload.callerName}. Fields pre-filled.`,
      activeProfile,
      'incoming_call',
    );
  };

  const handleSubmitForm = async (formToSave: CallIntakeForm) => {
    const res = await fetch('/api/call-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formToSave),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not save call form.');
      return;
    }
    setCallLogs(data.callLogs);
    setForm(EMPTY_FORM);
    setLastScreenedNotice('');
    showToast(`Saved call record for ${data.entry.callerName}`);
  };

  const handleAddContact = async (contact: Omit<ContactRecord, 'id'>) => {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    });
    const data = await res.json();
    if (res.ok) {
      setContacts(data.contacts);
      showToast(`Added ${data.contact.name} to directory.`);
    }
  };

  const handleDeleteContact = async (id: string) => {
    const res = await fetch(`/api/contacts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (res.ok) {
      setContacts(data.contacts);
    }
  };

  const handleTestCallFromContact = (contact: ContactRecord) => {
    handleCallerResolved({
      callerName: contact.name,
      phoneNumber: contact.phone,
      lookupSource: contact.source,
      callerContext: [contact.organization, contact.notes].filter(Boolean).join(' · '),
      suggestedCategory: contact.defaultCategory,
    });
  };

  const navItems: { id: AppTab; label: string; shortLabel: string; icon: typeof Mic }[] = [
    { id: 'form', label: 'Call Form', shortLabel: 'Form', icon: Mic },
    { id: 'voices', label: 'Voice Studio', shortLabel: 'Voices', icon: Sliders },
    { id: 'logs', label: 'Call Log', shortLabel: 'Logs', icon: History },
    { id: 'android', label: 'Android Setup', shortLabel: 'Android', icon: Code2 },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7F4] text-[#181715]">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-[#E5E1D8]">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Title (single line wordmark) */}
          <button
            type="button"
            onClick={() => setActiveTab('form')}
            className="text-lg font-bold tracking-tight text-[#181715] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Hazel
          </button>

          {/* Zone 2: 4 Single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-[#2F4F3E] text-[#181715]'
                      : 'border-transparent text-[#5C5852] hover:text-[#181715]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setIsSimulateModalOpen(true)}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#2F4F3E] hover:bg-[#243E30] text-white text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <PhoneIncoming className="w-3.5 h-3.5" />
              Simulate Call
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-10">
        {toastMessage && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#181715] text-white text-xs font-medium flex items-center justify-between">
            <span>{toastMessage}</span>
          </div>
        )}

        {isLoading ? (
          <div className="py-16 text-center text-sm text-[#5C5852]">
            Loading Hazel workspace...
          </div>
        ) : loadError ? (
          <div className="p-6 rounded-2xl bg-white border border-[#E5E1D8] text-sm text-[#9E2A2B]">
            {loadError}
          </div>
        ) : (
          <>
            {activeTab === 'form' && (
              <VoiceFormWorkspace
                form={form}
                setForm={setForm}
                voiceProfiles={voiceProfiles}
                activeProfile={activeProfile}
                onSelectVoiceProfile={handleSelectActiveVoice}
                onOpenVoiceStudio={() => setActiveTab('voices')}
                onOpenSimulateCall={() => setIsSimulateModalOpen(true)}
                onSubmitForm={handleSubmitForm}
                lastScreenedNotice={lastScreenedNotice}
              />
            )}

            {activeTab === 'voices' && (
              <VoiceStudio
                profiles={voiceProfiles}
                activeProfileId={activeVoiceProfileId}
                onSelectActive={handleSelectActiveVoice}
                onSaveProfile={handleSaveProfile}
                onDeleteProfile={handleDeleteProfile}
              />
            )}

            {activeTab === 'logs' && (
              <CallLogAndDirectory
                callLogs={callLogs}
                contacts={contacts}
                activeProfile={activeProfile}
                onAddContact={handleAddContact}
                onDeleteContact={handleDeleteContact}
                onTestCallFromContact={handleTestCallFromContact}
              />
            )}

            {activeTab === 'android' && <AndroidBlueprintView activeProfile={activeProfile} />}
          </>
        )}
      </main>

      {/* Mobile Bottom Thumb Navigation (<= 15% aggregate sticky height) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-[#E5E1D8] grid grid-cols-4 items-center"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[44px] h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-[#2F4F3E]' : 'text-[#5C5852]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-medium whitespace-nowrap">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      <IncomingCallModal
        isOpen={isSimulateModalOpen}
        contacts={contacts}
        onClose={() => setIsSimulateModalOpen(false)}
        onCallerResolved={handleCallerResolved}
      />
    </div>
  );
}
