import { useState } from 'react';
import { PhoneIncoming, PhoneOff, Search, X } from 'lucide-react';
import type { CallCategory, ContactRecord } from '../types';

interface IncomingCallModalProps {
  isOpen: boolean;
  contacts: ContactRecord[];
  onClose: () => void;
  onCallerResolved: (payload: {
    callerName: string;
    phoneNumber: string;
    lookupSource: string;
    callerContext: string;
    suggestedCategory: CallCategory;
  }) => void;
}

export function IncomingCallModal({
  isOpen,
  contacts,
  onClose,
  onCallerResolved,
}: IncomingCallModalProps) {
  const [phoneInput, setPhoneInput] = useState('+1 (415) 890-2314');
  const [step, setStep] = useState<'select' | 'screening'>('select');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const triggerScreening = async (numberToScreen: string) => {
    const trimmed = numberToScreen.trim();
    if (!trimmed) {
      setError('Enter an incoming phone number.');
      return;
    }

    setError('');
    setStep('screening');
    setStatusMessage('Intercepting Call.Details via CallScreeningService...');

    try {
      await new Promise((r) => setTimeout(r, 260));
      setStatusMessage('Querying ContactsContract & Cloud Caller ID...');

      const res = await fetch('/api/caller-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: trimmed }),
      });

      if (!res.ok) {
        throw new Error('Caller lookup failed.');
      }

      const data = await res.json();
      setStep('select');
      onCallerResolved({
        callerName: data.callerName,
        phoneNumber: data.phoneNumber,
        lookupSource: data.lookupSource,
        callerContext: data.callerContext || '',
        suggestedCategory: data.suggestedCategory || 'Inquiry',
      });
      onClose();
    } catch (err: unknown) {
      setStep('select');
      setError(err instanceof Error ? err.message : 'Unable to screen incoming call.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#181715]/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="simulate-call-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8] shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E1D8]">
          <div>
            <h2 id="simulate-call-title" className="text-lg font-semibold text-[#181715]">
              Simulate Incoming Call
            </h2>
            <p className="text-xs text-[#5C5852] mt-0.5">
              Tests CallScreeningService lookup and pre-fills Hazel’s voice form
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#5C5852] hover:text-[#181715] hover:bg-[#F1EFEA] transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {step === 'screening' ? (
            <div className="py-8 flex flex-col items-center text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#2F4F3E]/10 text-[#2F4F3E] flex items-center justify-center">
                <PhoneIncoming className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="font-mono text-base font-medium text-[#181715] tabular-nums">
                  {phoneInput}
                </p>
                <p className="text-sm text-[#5C5852]">{statusMessage}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="sim-phone-input"
                  className="block text-xs font-medium text-[#5C5852]"
                >
                  Incoming Phone Number
                </label>
                <div className="flex gap-2">
                  <input
                    id="sim-phone-input"
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="+1 (415) 555-0192"
                    className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl border border-[#E5E1D8] bg-[#F8F7F4] font-mono text-sm text-[#181715] focus:outline-none focus:ring-2 focus:ring-[#2F4F3E]/30 focus:border-[#2F4F3E]"
                  />
                  <button
                    type="button"
                    onClick={() => triggerScreening(phoneInput)}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#2F4F3E] text-white text-sm font-medium hover:bg-[#243E30] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
                  >
                    <PhoneIncoming className="w-4 h-4" />
                    Answer & Screen
                  </button>
                </div>
                {error && <p className="text-xs text-[#9E2A2B]">{error}</p>}
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-[#5C5852]">
                  Quick Test Callers
                </p>
                <div className="divide-y divide-[#E5E1D8] border border-[#E5E1D8] rounded-xl overflow-hidden">
                  {contacts.slice(0, 4).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setPhoneInput(c.phone);
                        triggerScreening(c.phone);
                      }}
                      className="w-full min-h-[56px] px-4 py-3 bg-white hover:bg-[#F8F7F4] text-left flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#181715] truncate">{c.name}</p>
                        <p className="text-xs text-[#5C5852] truncate">
                          {c.source} · {c.organization || c.defaultCategory}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-[#5C5852] tabular-nums shrink-0">
                        {c.phone}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const unknown = '+1 (312) 555-0194';
                      setPhoneInput(unknown);
                      triggerScreening(unknown);
                    }}
                    className="w-full min-h-[56px] px-4 py-3 bg-white hover:bg-[#F8F7F4] text-left flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <Search className="w-4 h-4 text-[#9A6B2F] shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[#181715]">Unlisted Incoming Number</p>
                        <p className="text-xs text-[#5C5852]">Cloud Caller ID lookup fallback</p>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-[#5C5852] tabular-nums shrink-0">
                      +1 (312) 555-0194
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium text-[#5C5852] hover:text-[#181715] hover:bg-[#F1EFEA] transition-colors flex items-center gap-1.5"
                >
                  <PhoneOff className="w-4 h-4" />
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
