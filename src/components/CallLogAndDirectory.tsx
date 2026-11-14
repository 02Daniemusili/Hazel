import { useState } from 'react';
import { PhoneIncoming, Plus, Trash2, Volume2 } from 'lucide-react';
import type { CallCategory, CallLogEntry, ContactRecord, VoiceProfile } from '../types';
import { speakAsHazel } from '../utils/hazelAudio';

interface CallLogAndDirectoryProps {
  callLogs: CallLogEntry[];
  contacts: ContactRecord[];
  activeProfile: VoiceProfile;
  onAddContact: (contact: Omit<ContactRecord, 'id'>) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onTestCallFromContact: (contact: ContactRecord) => void;
}

export function CallLogAndDirectory({
  callLogs,
  contacts,
  activeProfile,
  onAddContact,
  onDeleteContact,
  onTestCallFromContact,
}: CallLogAndDirectoryProps) {
  const [subTab, setSubTab] = useState<'logs' | 'contacts'>('logs');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [organization, setOrganization] = useState('');
  const [source, setSource] = useState<'ContactsContract' | 'Cloud CRM'>('ContactsContract');
  const [defaultCategory, setDefaultCategory] = useState<CallCategory>('Personal');
  const [adding, setAdding] = useState(false);

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setAdding(true);
    try {
      await onAddContact({
        name: name.trim(),
        phone: phone.trim(),
        source,
        organization: organization.trim() || undefined,
        defaultCategory,
      });
      setName('');
      setPhone('');
      setOrganization('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#181715]">Call Records & Caller Directory</h1>
          <p className="text-xs text-[#5C5852] mt-0.5">
            Saved voice-form submissions and ContactsContract / Cloud CRM lookup records
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F1EFEA] rounded-xl border border-[#E5E1D8]">
          <button
            type="button"
            onClick={() => setSubTab('logs')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              subTab === 'logs'
                ? 'bg-white text-[#181715] shadow-xs'
                : 'text-[#5C5852] hover:text-[#181715]'
            }`}
          >
            Saved Call Logs ({callLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('contacts')}
            className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              subTab === 'contacts'
                ? 'bg-white text-[#181715] shadow-xs'
                : 'text-[#5C5852] hover:text-[#181715]'
            }`}
          >
            Caller Directory ({contacts.length})
          </button>
        </div>
      </div>

      {subTab === 'logs' ? (
        <section className="bg-white rounded-2xl border border-[#E5E1D8] divide-y divide-[#E5E1D8] overflow-hidden">
          {callLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#5C5852]">
              No call logs saved yet. Complete the voice form to record your first call.
            </div>
          ) : (
            callLogs.map((log) => (
              <div
                key={log.id}
                className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C5852]">
                    <span>{log.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Priority: {log.priority}</span>
                    <span aria-hidden="true">·</span>
                    <span>{log.lookupSource}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className="text-base font-semibold text-[#181715]">{log.callerName}</h2>
                    <span className="font-mono text-xs text-[#5C5852] tabular-nums">
                      {log.phoneNumber}
                    </span>
                  </div>
                  <p className="text-sm text-[#181715]/85 leading-relaxed">
                    {log.notes || 'No notes recorded.'}
                  </p>
                  <p className="text-[11px] text-[#5C5852]">
                    Assisted by Hazel voice: {log.voiceProfileName}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    speakAsHazel(
                      `Call from ${log.callerName}, category ${log.category}, priority ${log.priority}. Notes: ${log.notes || 'none'}.`,
                      activeProfile,
                    )
                  }
                  className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <Volume2 className="w-3.5 h-3.5 text-[#2F4F3E]" />
                  Read Aloud
                </button>
              </div>
            ))
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E1D8] p-5 space-y-4">
            <h2 className="text-base font-semibold text-[#181715]">Add Contact / CRM Entry</h2>
            <form onSubmit={handleCreateContact} className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="dir-name" className="block text-xs font-medium text-[#5C5852]">
                  Full Name
                </label>
                <input
                  id="dir-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Sarah Jenkins"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm focus:outline-none focus:border-[#2F4F3E]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="dir-phone" className="block text-xs font-medium text-[#5C5852]">
                  Phone Number
                </label>
                <input
                  id="dir-phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (415) 555-0148"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] font-mono text-sm focus:outline-none focus:border-[#2F4F3E]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="dir-source" className="block text-xs font-medium text-[#5C5852]">
                    Lookup Source
                  </label>
                  <select
                    id="dir-source"
                    value={source}
                    onChange={(e) =>
                      setSource(e.target.value as 'ContactsContract' | 'Cloud CRM')
                    }
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm focus:outline-none focus:border-[#2F4F3E]"
                  >
                    <option value="ContactsContract">ContactsContract</option>
                    <option value="Cloud CRM">Cloud CRM</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="dir-cat" className="block text-xs font-medium text-[#5C5852]">
                    Default Category
                  </label>
                  <select
                    id="dir-cat"
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value as CallCategory)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm focus:outline-none focus:border-[#2F4F3E]"
                  >
                    <option value="Personal">Personal</option>
                    <option value="Inquiry">Inquiry</option>
                    <option value="Support">Support</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Follow-Up">Follow-Up</option>
                    <option value="Spam">Spam</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="dir-org" className="block text-xs font-medium text-[#5C5852]">
                  Organization / Relationship
                </label>
                <input
                  id="dir-org"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Optional label"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] text-sm focus:outline-none focus:border-[#2F4F3E]"
                />
              </div>

              <button
                type="submit"
                disabled={adding}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-[#2F4F3E] hover:bg-[#243E30] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {adding ? 'Adding...' : 'Add to Directory'}
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E1D8] divide-y divide-[#E5E1D8] overflow-hidden">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#181715]">{c.name}</p>
                  <p className="text-xs text-[#5C5852] mt-0.5">
                    <span className="font-mono tabular-nums">{c.phone}</span> · {c.source} ·{' '}
                    {c.organization || c.defaultCategory}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onTestCallFromContact(c)}
                    className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E5E1D8] bg-[#F8F7F4] hover:bg-[#F1EFEA] text-xs font-medium text-[#181715] flex items-center gap-1.5 transition-colors"
                  >
                    <PhoneIncoming className="w-3.5 h-3.5 text-[#2F4F3E]" />
                    Test Call
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteContact(c.id)}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-[#E5E1D8] text-[#9E2A2B] hover:bg-[#9E2A2B]/5 transition-colors"
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
