import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { findPlan, type Settings, type VoiceCheck, type VoiceErrorCode, type VoiceKeySource, type VoiceSource } from '@tayang/shared';
import elevenlabs from '@/assets/brand/elevenlabs.svg';
import fishaudio from '@/assets/brand/fishaudio.svg';
import gemini from '@/assets/brand/googlegemini.svg';
import tayang from '@/assets/brand/oyen-symbol-color.svg';
import voicestudio from '@/assets/brand/voicestudio.svg';
import { Button } from '@/components/Button';
import { lacksVoice } from '@/components/UpgradeCard';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { updateSettings, voiceKeyClear, voiceKeySave, voiceStatus, voiceStudioCheck } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

const VOICESTUDIO_URL = 'https://voicestudio.sh';

/** The sources in the order they are offered, each with its brand mark. */
const SOURCES: { id: VoiceSource; name: string; logo: string }[] = [
  { id: 'tayang', name: 'Tayang', logo: tayang },
  { id: 'elevenlabs', name: 'ElevenLabs', logo: elevenlabs },
  { id: 'fishaudio', name: 'Fish Audio', logo: fishaudio },
  { id: 'voicestudio', name: 'VoiceStudio', logo: voicestudio },
  { id: 'gemini', name: 'Gemini TTS', logo: gemini },
];
const KEYS_URL: Record<VoiceKeySource, string> = {
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  fishaudio: 'https://fish.audio/app/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
};
const isKeySource = (s: VoiceSource): s is VoiceKeySource => s in KEYS_URL;
const sourceOf = (id: VoiceSource) => SOURCES.find((s) => s.id === id) ?? SOURCES[0]!;

type ErrorKey = 'noKey' | 'badKey' | 'noBalance' | 'notRunning' | 'busy' | 'failed';
const ERROR_KEY: Record<VoiceErrorCode, ErrorKey> = {
  'no-key': 'noKey',
  'bad-key': 'badKey',
  'no-balance': 'noBalance',
  'not-running': 'notRunning',
  'too-long': 'failed',
  busy: 'busy',
  failed: 'failed',
};

function Status({ ok, children }: { ok: boolean; children: string }) {
  return (
    <p role="status" className={cn('m-0 flex items-center gap-2 text-[13px]', ok ? 'text-[#D9D9D9]' : 'text-orange-light')}>
      {ok && <Check size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-foreground" />}
      {children}
    </p>
  );
}

const linkClass = 'text-xs text-primary underline hover:text-accent-hover';

/** The cheapest plan with Tayang's voice-overs. */
const VOICE_PLAN = 'creator' as const;

/** Tayang's own voice: what it costs, or, without a plan that has it, where to get one. */
function TayangPanel() {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const { status, loadedAt, failed } = useBilling();

  // Signed in with no plan state yet: ask, so a subscriber never sees the offer.
  useEffect(() => {
    if (signedIn && loadedAt === 0 && !failed) void useBilling.getState().refresh();
  }, [signedIn, loadedAt, failed]);

  const known = !signedIn || (loadedAt > 0 && !failed);
  if (!known || !lacksVoice(signedIn ? status : null)) {
    return <span className="text-[13px] text-text-2">{t('voice.tayangText')}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="min-w-60 flex-1 text-[13px] text-text-2">{t('voice.tayangNoPlan', { plan: findPlan(VOICE_PLAN)?.name ?? '' })}</span>
      <Button className="h-9 px-3 text-[13px]" onClick={() => navigate({ name: 'plans', plan: VOICE_PLAN })}>
        {t('upgradeCard.cta')}
      </Button>
    </div>
  );
}

/** ElevenLabs, Fish Audio or Gemini: the API key, and what trying it said. */
function KeyPanel({ source, active, inUse, hasKey, onHasKey, onSaved, onBusy, onRemove }: {
  source: VoiceKeySource;
  active: boolean;
  inUse: string;
  hasKey: boolean | null;
  onHasKey(has: boolean): void;
  onSaved(s: Settings): void;
  onBusy(busy: boolean): void;
  onRemove(returnFocus: boolean): void;
}) {
  const { t } = useTranslation();
  const { name } = sourceOf(source);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<VoiceCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const canSave = !!key.trim() || hasKey !== false;
  const fail = (e: unknown) => setError(t('settings.saveError', { message: e instanceof Error ? e.message : String(e) }));

  const save = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setCheck(null);
    try {
      const [result, saved] = await voiceKeySave(source, key.trim() || null);
      setCheck(result);
      if (result.ok) {
        onHasKey(true);
        setKey('');
        onSaved(saved);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setCheck(null);
    try {
      const saved = await voiceKeyClear(source);
      onRemove(document.activeElement === removeButton.current);
      onHasKey(false);
      setKey('');
      onSaved(saved);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const invalid = check?.error === 'bad-key';
  const resultError = check && !check.ok ? t(`voice.errors.${ERROR_KEY[check.error ?? 'failed']}`, { name }) : '';
  const result = check?.ok
    ? check.hasCredit === false
      ? source === 'fishaudio' ? t('voice.fishFree') : t('voice.errors.noBalance', { name })
      : t('voice.connected', { name })
    : '';

  return (
    <form autoComplete="off" className="flex min-w-0 flex-col gap-2" onSubmit={(event) => {
      event.preventDefault();
      void save();
    }}>
      <span id="voice-key-hint" className="text-[13px] text-text-2">{t('voice.keyText', { name })}{source === 'gemini' && ` ${t('settings.geminiApiKeyHint')} ${t('voice.geminiNote')}`}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${source}-key`} className="text-[13px] text-[#D9D9D9]">
          {t('voice.keyLabel', { name })}
        </label>
        <a href={KEYS_URL[source]} target="_blank" rel="noreferrer" className={linkClass}>
          {t('voice.getKey')}
        </a>
      </div>
      {hasKey && <span id="voice-key-saved" className="text-xs text-text-3">{t('voice.keySaved')}</span>}
      <div className="flex flex-wrap gap-2">
        <Input
          id={`${source}-key`}
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setCheck(null); }}
          readOnly={busy}
          aria-invalid={invalid || undefined}
          aria-describedby={cn('voice-key-hint', hasKey && 'voice-key-saved', invalid && 'voice-key-error')}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 border-text-3 bg-background font-mono text-[13px]"
        />
        <Button type="submit" variant="light" className="h-9 px-3 text-[13px] font-semibold aria-disabled:opacity-50" aria-disabled={busy || !canSave}>
          {t('voice.keySave')}
        </Button>
        {hasKey !== false && (
          <Button ref={removeButton} type="button" variant="ghost" className="h-9 px-2 text-[13px] aria-disabled:opacity-50" aria-disabled={busy} onClick={() => void remove()}>
            {t('voice.keyRemove')}
          </Button>
        )}
      </div>
      <p role="status" className="m-0 text-[13px] text-text-2 empty:absolute">
        {busy ? t('voice.checking') : result}
      </p>
      {!check && !active && hasKey === false && <span className="text-xs text-text-3">{t('voice.notYet', { name: inUse })}</span>}
      <p id="voice-key-error" role="alert" className="m-0 text-[13px] text-orange-light empty:absolute">
        {error || resultError || (source === 'gemini' && hasKey === null && t('settings.geminiKeychainError'))}
      </p>
    </form>
  );
}

/**
 * Settings › Tools: where voice-overs come from. Tayang credits, the user's own ElevenLabs, Fish
 * Audio or Gemini key, or VoiceStudio on this computer. Agents always call Tayang's /voice; this picks who speaks.
 */
export function VoiceSourceCard({ settings, onSaved }: { settings: Settings; onSaved(s: Settings): void }) {
  const { t } = useTranslation();
  const active: VoiceSource = settings.voiceSource ?? 'tayang';
  /** A source with a key that was picked to set up its key: its panel is open even while another source is in use. */
  const [setup, setSetup] = useState<VoiceKeySource | null>(null);
  const shown: VoiceSource = setup ?? active;
  const [hasKey, setHasKey] = useState<Record<VoiceKeySource, boolean | null>>({ elevenlabs: false, fishaudio: false, gemini: false });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [savingSource, setSavingSource] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [studio, setStudio] = useState<VoiceCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    voiceStatus().then(
      (s) => setHasKey({ elevenlabs: s.hasElevenKey, fishaudio: s.hasFishKey, gemini: s.hasGeminiKey }),
      () => setHasKey((keys) => ({ ...keys, gemini: null })),
    );
  }, []);

  const checkStudio = () => {
    setStudio(null);
    voiceStudioCheck().then(setStudio, () => setStudio({ ok: false, error: 'failed', hasCredit: null }));
  };
  useEffect(() => {
    if (shown === 'voicestudio') checkStudio();
  }, [shown]);

  const pick = async (source: VoiceSource) => {
    if (savingSource || keyBusy) return;
    setError(null);
    setNotice('');
    // A source with a key only becomes the one in use once its key is saved.
    if (isKeySource(source) && !hasKey[source]) {
      setSetup(source);
      return;
    }
    setSetup(null);
    if (source === active) return;
    setSavingSource(true);
    try {
      const saved = await updateSettings({ voiceSource: source });
      if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
      onSaved(saved);
    } catch (e) {
      setError(t('settings.saveError', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSavingSource(false);
    }
  };

  const label = t('voice.source');
  // The button follows what was picked; a source still waiting for its key says so.
  const current = sourceOf(shown);
  const pending = shown !== active;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <span className="text-sm">{label}</span>
          <span className="text-xs text-text-3">{t('voice.sourceHint')}</span>
        </div>
        <DropdownMenu open={menuOpen} onOpenChange={(open) => {
          if (!open || (!savingSource && !keyBusy)) setMenuOpen(open);
        }}>
          <DropdownMenuTrigger asChild>
            <button
              ref={trigger}
              type="button"
              aria-describedby={pending ? "voice-source-pending" : undefined}
              aria-disabled={savingSource || keyBusy || undefined}
              aria-label={`${label}: ${current.name}`}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-text-3 bg-background px-3 text-[13px] text-foreground hover:bg-raised"
            >
              <img src={current.logo} alt="" aria-hidden="true" className="size-4 shrink-0" />
              {current.name}
              {pending && <span id="voice-source-pending" className="text-[11px] text-orange-light">{t('voice.pending')}</span>}
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 border-hairline bg-card">
            <DropdownMenuRadioGroup value={active}>
              {SOURCES.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id} disabled={savingSource || keyBusy} onSelect={() => void pick(o.id)} className="h-9 gap-2 text-[13px]">
                  <img src={o.logo} alt="" aria-hidden="true" className="size-4 shrink-0" />
                  <span className="font-medium">{o.name}</span>
                  {o.id !== active && isKeySource(o.id) && hasKey[o.id] === false && (
                    <span className="ml-auto text-[11px] text-text-3">{t('voice.needsKey')}</span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={panel} className="flex flex-col gap-3 border-t border-[#222] px-4 py-3">
        {shown === 'tayang' && <TayangPanel />}

        {isKeySource(shown) && (
          <KeyPanel
            key={shown}
            source={shown}
            active={active === shown}
            inUse={sourceOf(active).name}
            hasKey={hasKey[shown]}
            onHasKey={(has) => setHasKey((k) => ({ ...k, [shown]: has }))}
            onSaved={onSaved}
            onBusy={setKeyBusy}
            onRemove={(returnFocus) => {
              if (returnFocus || (active === shown && panel.current?.contains(document.activeElement))) trigger.current?.focus();
              setSetup(null);
              setNotice(t('voice.keyRemoved'));
            }}
          />
        )}

        {shown === 'voicestudio' && (
          <>
            <span className="text-[13px] text-text-2">{t('voice.studioText')}</span>
            <div className="flex flex-wrap items-center gap-3">
              <Status ok={studio?.ok ?? false}>
                {t(studio === null ? 'voice.checking' : studio.ok ? 'voice.studioOpen' : 'voice.studioClosed')}
              </Status>
              <Button variant="secondary" className="ml-auto h-7 gap-1 rounded-sm bg-transparent px-2 text-xs text-[#D9D9D9]" aria-disabled={studio === null} onClick={() => { if (studio !== null) checkStudio(); }}>
                <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
                {t('settings.checkAgain')}
              </Button>
            </div>
            <span className="text-xs text-text-3">
              {t('voice.studioNote')}{' '}
              <a href={VOICESTUDIO_URL} target="_blank" rel="noreferrer" className={linkClass}>
                {t('voice.studioGet')}
              </a>
            </span>
          </>
        )}

        <p role="status" className="m-0 text-[13px] text-text-2 empty:absolute">{notice}</p>
        <p role="alert" className="m-0 text-[13px] text-orange-light empty:absolute">{error}</p>
      </div>
    </div>
  );
}
