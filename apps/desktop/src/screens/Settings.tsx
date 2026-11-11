import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { disable as disableAutostart, enable as enableAutostart } from '@tauri-apps/plugin-autostart';
import { openUrl } from '@tauri-apps/plugin-opener';
import { RadioGroup as Radio, Tabs } from 'radix-ui';
import { DEFAULT_SETTINGS, type AgentInfo, type Settings as SettingsT, type SystemInfo, type ToolId } from '@tayang/shared';
import { AccountSection } from '@/components/Account';
import { ArchiveSection } from '@/components/ArchiveSection';
import { GiftCode } from '@/components/GiftCode';
import { UsageTab } from '@/components/UsageTab';
import { ClaudeAccountControl } from '@/components/ClaudeAccountControl';
import { AgentLogo } from '@/components/AgentLogo';
import { ApiSetupDialog } from '@/components/ApiSetupDialog';
import { Button } from '@/components/Button';
import { ToolRow, TOOL_ORDER } from '@/components/ToolRow';
import { VoiceSourceCard } from '@/components/VoiceSourceCard';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { AGENT_INSTALL_URL, AGENT_NAMES } from '@/lib/agents';
import { apiClear, apiUrlOverride, detectAgents, getSettings, getSystemInfo, openverseCredentialsSaved, pickFolder, updateOpenverseCredentials, updateSettings } from '@/lib/ipc';

/** What Rust says when background mode can't make its tray (and turned it back off). */
const TRAY_UNAVAILABLE = 'tray-unavailable';
import { LANGUAGES, LANGUAGE_NAMES, uiLanguage } from '@/i18n';
import { chooseLanguage } from '@/lib/language';
import { sendTestNotification } from '@/lib/scheduler';
import { useApp } from '@/state/app';
import { useInstall } from '@/state/install';
import { useUpdater } from '@/state/updater';

const SECTIONS = ['general', 'agents', 'video', 'render', 'tools', 'usage', 'account', 'archive'] as const;
export type SettingsTab = (typeof SECTIONS)[number];

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card">{children}</div>;
}

/** The app's version and a manual update check; what to do with a found update is in the sidebar. */
function UpdatesRow({ dev = import.meta.env.DEV }: { dev?: boolean }) {
  const { t } = useTranslation();
  const { phase, version, error, check } = useUpdater();
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    getVersion()
      .then((v) => !gone && setCurrent(v))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);
  const status = dev
    ? t('updates.devBuild')
    : phase === 'checking'
      ? t('updates.checking')
      : phase === 'none'
        ? t('updates.upToDate')
        : phase === 'available' || phase === 'downloading' || phase === 'ready'
          ? t('updates.available', { version: version ?? '' })
          : phase === 'error' && error
            ? t('updates.failed', { message: error })
            : undefined;
  return (
    <Row label={t('updates.label')} hint={current ? t('updates.version', { version: current }) : undefined} note={status} announceNote>
      <Button variant="secondary" disabled={dev || phase === 'checking'} onClick={() => void check()}>
        {t('updates.check')}
      </Button>
    </Row>
  );
}

/** Settings › Account points to Social media, where the accounts and auto-posts live. */
function SocialLink() {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="mr-auto flex flex-col gap-1">
        <span className="text-sm font-medium">{t('social.settingsTitle')}</span>
        <span className="text-xs text-text-3">{t('social.settingsHint')}</span>
      </div>
      <Button variant="secondary" onClick={() => navigate({ name: 'social' })}>
        {t('social.open')}
      </Button>
    </div>
  );
}

function Row({ id, label, hint, note, announceNote, children }: {
  id?: string;
  label: string;
  hint?: string;
  note?: string;
  announceNote?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[#222] px-4 py-3 last:border-b-0">
      <div className="mr-auto flex min-w-0 flex-col gap-1">
        <span id={id && `${id}-label`} className="text-sm">{label}</span>
        {hint && <span id={id && `${id}-hint`} className="text-xs text-text-3">{hint}</span>}
        {(note || announceNote) && (
          <span id={id && `${id}-note`} role={announceNote ? 'status' : undefined} className="text-xs text-text-3">{note}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function OpenverseCredentials() {
  const { t } = useTranslation();
  const form = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState('');

  useEffect(() => {
    let gone = false;
    openverseCredentialsSaved().then((value) => {
      if (!gone) setSaved(value);
    }).catch(() => {
      if (!gone) setErrorCode('keychain');
    }).finally(() => {
      if (!gone) setLoading(false);
    });
    return () => { gone = true; };
  }, []);

  const update = async (credentials: Parameters<typeof updateOpenverseCredentials>[0]) => {
    if (loading || busy || (credentials === null && saved === false)) return;
    setErrorCode('');
    setBusy(true);
    try {
      await updateOpenverseCredentials(credentials);
      form.current?.reset();
      setSaved(credentials !== null);
    } catch (cause) {
      setErrorCode(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void update({ clientId: String(data.get('clientId')), clientSecret: String(data.get('clientSecret')) });
  };
  const errorMessage = {
    'invalid-credentials': t('settings.openverseInvalidCredentials'),
    'rate-limited': t('settings.openverseRateLimited'),
    keychain: t('settings.openverseKeychainError'),
    docs: t('settings.openverseDocsError'),
  };
  const unavailable = loading || busy;
  const invalid = errorCode === 'invalid-credentials';
  const savedStatus = saved === null || (errorCode && errorCode !== 'docs')
    ? null
    : t(saved ? 'settings.openverseCredentialsSaved' : 'settings.openverseAnonymous');

  return (
    <form ref={form} onSubmit={save} onChange={() => { if (invalid) setErrorCode(''); }} autoComplete="off" className="px-4 py-3">
      <fieldset aria-describedby="openverse-credentials-hint" className="grid min-w-0 gap-2">
        <legend className="mb-1 text-sm">{t('settings.openverseCredentials')}</legend>
        <p id="openverse-credentials-hint" className="m-0 text-xs text-text-3">{t('settings.openverseCredentialsHint')}</p>
        <Button type="button" variant="secondary" className="w-fit" onClick={() => {
          void openUrl('https://api.openverse.org/v1/#section/Register-and-Authenticate').catch(() => setErrorCode('docs'));
        }}>
          {t('settings.openverseRegistration')}
        </Button>
        <label htmlFor="openverse-client-id" className="text-sm">{t('settings.openverseClientId')}</label>
        {/* i18n-ignore: autoCapitalize keyword. */}
        <Input id="openverse-client-id" name="clientId" type="text" required maxLength={512} spellCheck={false} autoCapitalize="none" readOnly={busy} className="border-text-3"
          aria-invalid={invalid || undefined} aria-describedby={invalid ? 'openverse-credentials-error' : undefined} />
        <label htmlFor="openverse-client-secret" className="text-sm">{t('settings.openverseClientSecret')}</label>
        <Input id="openverse-client-secret" name="clientSecret" type="password" required maxLength={512} readOnly={busy} className="border-text-3"
          aria-invalid={invalid || undefined} aria-describedby={invalid ? 'openverse-credentials-error' : undefined} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" aria-disabled={unavailable} className="aria-disabled:opacity-50"
            onClick={(event) => { if (unavailable) event.preventDefault(); }}>
            {t('settings.openverseSaveCredentials')}
          </Button>
          <Button type="button" variant="secondary" aria-disabled={unavailable || saved === false} className="aria-disabled:opacity-50" onClick={() => void update(null)}>
            {t('settings.openverseRemoveCredentials')}
          </Button>
        </div>
        <p role="status" className="m-0 text-xs text-text-3">
          {busy ? t('settings.openverseUpdating') : savedStatus}
        </p>
        <p id="openverse-credentials-error" role="alert" className="m-0 text-sm text-destructive">
          {errorCode && (errorMessage[errorCode as keyof typeof errorMessage] ?? t('settings.openverseCredentialsError'))}
        </p>
      </fieldset>
    </form>
  );
}

function Segmented<T extends string>({
  id,
  withHint,
  value,
  options,
  onChange,
}: {
  id: string;
  withHint?: boolean;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(v: T): void;
}) {
  return (
    <Radio.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      orientation="horizontal"
      aria-labelledby={`${id}-label`}
      aria-describedby={withHint ? `${id}-hint` : undefined}
      className="flex h-9 w-fit shrink-0 items-center rounded-lg bg-background p-[3px]"
    >
      {options.map((o) => (
        <Radio.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className="h-full cursor-pointer rounded-md border border-transparent px-3 text-[13px] font-medium whitespace-nowrap text-text-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-raised data-[state=checked]:text-foreground"
        >
          {o.label}
        </Radio.Item>
      ))}
    </Radio.Root>
  );
}


const TAB_KEY = 'tayang.settingsTab';
const isTab = (v: unknown): v is SettingsTab => typeof v === 'string' && (SECTIONS as readonly string[]).includes(v);

/** The tab Settings opens on: the one asked for, else the one last used, else General. */
function startTab(asked: string | undefined): SettingsTab {
  if (isTab(asked)) return asked;
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (isTab(saved)) return saved;
  } catch {
    /* storage off: General */
  }
  return 'general';
}

export function Settings() {
  const { t } = useTranslation();
  // TAYANG_API_URL (a dev setup) wins over the address saved here: say so instead of showing a value that isn't used.
  const [apiOverride, setApiOverride] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve()
      .then(() => apiUrlOverride())
      .then((v) => setApiOverride(v ?? null))
      .catch(() => setApiOverride(null));
  }, []);
  const settings = useApp((s) => s.settings);
  const askedTab = useApp((s) => (s.route.name === 'settings' ? s.route.tab : undefined));
  const [tab, setTab] = useState<SettingsTab>(() => startTab(askedTab));
  const accountTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isTab(askedTab)) setTab(askedTab);
  }, [askedTab]);
  const pickTab = (id: SettingsTab) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* the choice just won't be remembered */
    }
  };
  const setSettings = useApp((s) => s.setSettings);
  const navigate = useApp((s) => s.navigate);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [apiOpen, setApiOpen] = useState(false);
  const reloadAgents = () => void detectAgents().then(setAgents, () => {});
  const removeApi = async () => {
    setError(null);
    try {
      setSettings(await apiClear());
      reloadAgents();
    } catch {
      setError(t('settings.apiRemoveFailed'));
    }
  };
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingTools, setCheckingTools] = useState(true);
  const [toolCheckError, setToolCheckError] = useState<string | null>(null);
  const checkId = useRef(0);
  const statuses = useInstall((s) => s.statuses);
  const active = useInstall((s) => s.active);
  const closing = useInstall((s) => s.closing);
  const refresh = useInstall((s) => s.refresh);
  const start = useInstall((s) => s.start);
  const agentId = settings?.defaultAgent ?? 'claude';
  const agentName = AGENT_NAMES[agentId];

  const check = useCallback(async () => {
    const id = ++checkId.current;
    setCheckingTools(true);
    setToolCheckError(null);
    try {
      await refresh(agentId);
    } catch (e) {
      if (id === checkId.current) setToolCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === checkId.current) setCheckingTools(false);
    }
  }, [refresh, agentId]);

  useEffect(() => {
    useInstall.getState().listen();
    detectAgents()
      .then(setAgents)
      .catch(() => {});
    getSystemInfo()
      .then(setSys)
      .catch(() => {});
  }, []);
  useEffect(() => {
    void check();
    return () => { checkId.current++; };
  }, [check]);

  const [apiError, setApiError] = useState<string | null>(null);
  const save = async (patch: Partial<SettingsT>) => {
    setError(null);
    try {
      setSettings(await updateSettings(patch));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === TRAY_UNAVAILABLE) {
        // Rust turned background mode back off: show the saved settings and say why.
        setError(t('settings.trayUnavailable'));
        void getSettings().then(setSettings, () => {});
        return;
      }
      setError(t('settings.saveError', { message }));
    }
  };

  // Background mode keeps the app alive in the tray; "Open at login" only makes sense with it, so turning
  // the background off also turns the login item off. A failed OS change leaves the setting as it was.
  const changeBackground = async (on: boolean) => {
    if (!on && settings?.openAtLogin) {
      try {
        await disableAutostart();
      } catch (e) {
        setError(t('settings.backgroundError', { message: e instanceof Error ? e.message : String(e) }));
        return;
      }
      await save({ backgroundMode: false, openAtLogin: false });
      return;
    }
    await save({ backgroundMode: on });
  };
  const changeOpenAtLogin = async (on: boolean) => {
    try {
      await (on ? enableAutostart() : disableAutostart());
    } catch (e) {
      setError(t('settings.backgroundError', { message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    await save({ openAtLogin: on });
  };

  const [testLine, setTestLine] = useState<string | null>(null);
  const testNotification = async () => {
    setTestLine(null);
    try {
      setTestLine((await sendTestNotification()) ? t('settings.testSent') : t('reminders.blocked'));
    } catch (e) {
      setTestLine(t('settings.testFailed', { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  const changeFolder = async () => {
    try {
      const path = await pickFolder();
      if (path) await save({ workingFolder: path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!settings) return null;

  const install = (tool: ToolId) => {
    if (sys) void start(tool, { sys, agent: agentId });
  };
  const tools = [...statuses].sort((a, b) => TOOL_ORDER.indexOf(a.id) - TOOL_ORDER.indexOf(b.id));

  return (
    // i18n-ignore: Radix keyboard activation option.
    <Tabs.Root value={tab} onValueChange={(id) => pickTab(id as SettingsTab)} orientation="vertical" activationMode="manual" className="flex h-full flex-wrap content-start gap-8 overflow-y-auto p-8">
      <h1 data-tauri-drag-region className="m-0 flex-[1_1_100%] text-[28px] font-semibold tracking-[-0.01em]">
        {t('settings.title')}
      </h1>

      <Tabs.List aria-label={t('settings.sectionsAria')} className="flex flex-[0_0_180px] flex-col gap-1">
        {SECTIONS.map((id) => (
          <Tabs.Trigger
            key={id}
            ref={id === 'account' ? accountTab : undefined}
            value={id}
            className="flex h-9 cursor-pointer items-center rounded-md px-3 text-left text-sm font-medium text-text-2 hover:bg-raised hover:text-foreground data-[state=active]:bg-raised data-[state=active]:text-foreground"
          >
            {t(`settings.sections.${id}`)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="flex max-w-[720px] min-w-0 flex-[999_1_460px] flex-col gap-8">
        <div role="alert" className="text-[13px] text-orange-light empty:absolute">
          {error}
        </div>

        <Tabs.Content value="general" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <h2 className="m-0 text-base font-medium">{t('settings.sections.general')}</h2>
          <Card>
            <Row id="settings-language" label={t('settings.language')} hint={t('settings.languageHint')}>
              <Segmented
                id="settings-language"
                withHint
                value={uiLanguage()}
                options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))}
                onChange={(l) => void chooseLanguage(l)}
              />
            </Row>
            <UpdatesRow />
          </Card>
        </Tabs.Content>

        <Tabs.Content value="agents" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-base font-medium">{t('settings.sections.agents')}</h2>
            <span className="text-[13px] text-text-2">{t('settings.agentsIntro')}</span>
          </div>
          <span id="default-agent-label" className="text-[13px] font-medium">
            {t('settings.defaultAgent')}
          </span>
          <Card>
            <RadioGroup
              aria-labelledby="default-agent-label"
              value={settings.defaultAgent}
              onValueChange={(v) => void save({ defaultAgent: v as SettingsT['defaultAgent'] })}
              className="gap-0"
            >
              {agents.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <RadioGroupItem value={a.id} id={`agent-${a.id}`} disabled={!a.installed} aria-describedby={`agent-${a.id}-status`} />
                  <AgentLogo id={a.id} size={20} />
                  <div className="mr-auto flex min-w-0 flex-col gap-1">
                    <label htmlFor={`agent-${a.id}`} id={`agent-${a.id}-label`} className="text-sm font-medium">{a.id === 'custom' ? t('agents.yourApi') : AGENT_NAMES[a.id]}</label>
                    <span id={`agent-${a.id}-status`} className="text-xs text-text-3">
                      {a.id === 'custom'
                        ? a.installed && a.version ? t('onboarding.connect.yourApiReady', { model: a.version }) : t('onboarding.connect.yourApiHint')
                        : a.installed ? (a.version ? t('settings.connectedVersion', { version: a.version }) : t('settings.connected')) : t('settings.notInstalled')}
                    </span>
                  </div>
                  {a.id === 'custom' ? (
                    <div className="flex items-center gap-1">
                      {a.installed && (
                        <Button id="agent-custom-remove" aria-labelledby="agent-custom-remove agent-custom-label" variant="ghost" onClick={() => void removeApi()}>
                          {t('settings.apiRemove')}
                        </Button>
                      )}
                      <Button id="agent-custom-setup" aria-labelledby="agent-custom-setup agent-custom-label" variant="ghost" onClick={() => setApiOpen(true)}>
                        {a.installed ? t('settings.apiChange') : t('onboarding.connect.setUp')}
                      </Button>
                    </div>
                  ) : a.id === 'claude' && a.installed ? (
                    <ClaudeAccountControl showSignOut />
                  ) : a.installed ? (
                    <Button id={`agent-${a.id}-action`} aria-labelledby={`agent-${a.id}-action agent-${a.id}-label`} variant="ghost" className="h-8 px-2 text-[13px] text-primary hover:text-accent-hover" onClick={() => navigate({ name: 'connect' })}>
                      {t('settings.reconnect')}
                    </Button>
                  ) : (
                    <a id={`agent-${a.id}-install`} aria-labelledby={`agent-${a.id}-install agent-${a.id}-label`}
                      href={AGENT_INSTALL_URL[a.id]} target="_blank" rel="noreferrer"
                      className="inline-flex h-8 items-center px-2 text-[13px] font-medium text-primary hover:text-accent-hover">
                      {t('settings.howToInstall')}
                    </a>
                  )}
                </div>
              ))}
            </RadioGroup>
          </Card>
          <ApiSetupDialog open={apiOpen} onOpenChange={setApiOpen} onSaved={(next) => {
            setSettings(next);
            reloadAgents();
          }} />
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="frame-check" className="text-sm font-medium">
                {t('settings.frameCheck')}
              </label>
              <span id="frame-check-hint" className="text-xs text-text-3">{t('settings.frameCheckHint')}</span>
            </div>
            <Switch
              id="frame-check"
              checked={settings.frameCheck}
              aria-describedby="frame-check-hint"
              onCheckedChange={(v) => void save({ frameCheck: v })}
            />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="auto-mode" className="text-sm font-medium">
                {t('settings.autoMode')}
              </label>
              <span id="auto-mode-hint" className="text-xs text-text-3">{t('settings.autoModeHint')}</span>
              <span id="auto-mode-autopilots" className="text-xs text-text-3">{t('settings.autoModeAutopilots')}</span>
            </div>
            <Switch
              id="auto-mode"
              checked={settings.autoMode}
              aria-describedby="auto-mode-hint auto-mode-autopilots"
              onCheckedChange={(v) => void save({ autoMode: v })}
            />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="background-mode" className="text-sm font-medium">
                {t('settings.background')}
              </label>
              <span id="background-mode-hint" className="text-xs text-text-3">{t('settings.backgroundHint')}</span>
            </div>
            <Switch
              id="background-mode"
              checked={settings.backgroundMode}
              aria-describedby="background-mode-hint"
              onCheckedChange={(v) => void changeBackground(v)}
            />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="open-at-login" className="text-sm font-medium">
                {t('settings.openAtLogin')}
              </label>
              <span id="open-at-login-hint" className="text-xs text-text-3">{t('settings.openAtLoginHint')}</span>
            </div>
            <Switch
              id="open-at-login"
              checked={settings.backgroundMode && settings.openAtLogin}
              disabled={!settings.backgroundMode}
              aria-describedby="open-at-login-hint"
              onCheckedChange={(v) => void changeOpenAtLogin(v)}
            />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <span className="text-sm font-medium">{t('settings.testNotification')}</span>
              <span role="status" className="text-xs text-text-3 empty:absolute">
                {testLine}
              </span>
            </div>
            <Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => void testNotification()}>
              {t('settings.testNotification')}
            </Button>
          </div>
        </Tabs.Content>

        <Tabs.Content value="video" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <h2 className="m-0 text-base font-medium">{t('settings.sections.video')}</h2>
          <Card>
            <Row id="video-language" label={t('settings.videoLanguage')}>
              <Segmented
                id="video-language"
                value={settings.language}
                options={[
                  { value: 'id', label: LANGUAGE_NAMES.id },
                  { value: 'en', label: LANGUAGE_NAMES.en },
                ]}
                onChange={(language) => void save({ language })}
              />
            </Row>
            <Row id="video-format" label={t('settings.format')}>
              <Segmented
                id="video-format"
                value={settings.format}
                options={[
                  { value: '9:16', label: '9:16' },
                  { value: '1:1', label: '1:1' },
                  { value: '16:9', label: '16:9' },
                ]}
                onChange={(format) => void save({ format })}
              />
            </Row>
            <Row id="video-frame-rate" label={t('settings.frameRate')}>
              <Segmented
                id="video-frame-rate"
                value={String(settings.fps)}
                options={['24', '30', '60'].map((v) => ({ value: v, label: t('settings.fps', { n: v }) }))}
                onChange={(v) => void save({ fps: Number(v) })}
              />
            </Row>
            <Row id="openverse-sound-effects" label={t('settings.openverseSoundEffects')} hint={t('settings.openverseSoundEffectsHint')}>
              <Switch
                aria-labelledby="openverse-sound-effects-label"
                aria-describedby="openverse-sound-effects-hint"
                checked={settings.openverseSoundEffects ?? false}
                onCheckedChange={(openverseSoundEffects) => void save({ openverseSoundEffects })}
              />
            </Row>
            <OpenverseCredentials />
          </Card>
        </Tabs.Content>

        <Tabs.Content value="render" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <h2 className="m-0 text-base font-medium">{t('settings.sections.render')}</h2>
          <Card>
            <Row
              id="working-folder"
              label={t('settings.workingFolder')}
              hint={t('settings.workingFolderHint')}
              note={t('settings.workingFolderNote')}
            >
              <span id="working-folder-path" role="status" className="max-w-[220px] truncate font-mono text-xs text-[#D9D9D9]" title={settings.workingFolder}>
                {settings.workingFolder}
              </span>
              <Button id="change-working-folder" aria-labelledby="change-working-folder working-folder-label" aria-describedby="working-folder-path working-folder-hint working-folder-note" variant="secondary" className="h-7 rounded-sm px-2 text-xs" onClick={() => void changeFolder()}>
                {t('settings.change')}
              </Button>
            </Row>
            <Row id="render-location" label={t('settings.whereToRender')} hint={t('settings.whereToRenderHint')}>
              <Segmented
                id="render-location"
                withHint
                value="local"
                options={[
                  { value: 'local', label: t('settings.thisComputer') },
                  { value: 'cloud', label: t('settings.cloud'), disabled: true },
                ]}
                onChange={() => {}}
              />
            </Row>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="tools" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <div className="flex items-center gap-3">
            <div className="mr-auto flex flex-col gap-1">
              <h2 className="m-0 text-base font-medium">{t('settings.sections.tools')}</h2>
              <span className="text-[13px] text-text-2">{t('settings.toolsIntro', { agent: agentName })}</span>
            </div>
            <Button
              variant="secondary"
              className="h-7 gap-1 rounded-sm bg-transparent px-2 text-xs text-[#D9D9D9]"
              disabled={!!active || closing}
              aria-disabled={checkingTools || undefined}
              onClick={() => { if (!checkingTools) void check(); }}
            >
              <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
              {t('settings.checkAgain')}
            </Button>
          </div>
          <div role="status" className="text-[13px] text-text-2 empty:absolute">
            {checkingTools ? t('updates.checking') : !toolCheckError && t('settings.toolsChecked')}
          </div>
          <div role="alert" className="text-[13px] text-orange-light empty:absolute">{toolCheckError}</div>
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0">
            {tools.map((t) => (
              <ToolRow
                key={t.id}
                tool={t}
                sys={sys}
                agentName={agentName}
                busy={!!active || closing || !sys}
                onInstall={() => install(t.id)}
              />
            ))}
          </ul>
          <h3 className="m-0 mt-3 text-sm font-medium">{t('voice.title')}</h3>
          <VoiceSourceCard settings={settings} onSaved={setSettings} />
        </Tabs.Content>

        <Tabs.Content value="archive" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <h2 className="m-0 text-base font-medium">{t('settings.sections.archive')}</h2>
          <ArchiveSection />
        </Tabs.Content>

        <Tabs.Content value="usage" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <h2 className="m-0 text-base font-medium">{t('settings.sections.usage')}</h2>
          <UsageTab onAccount={() => {
            pickTab('account');
            accountTab.current?.focus();
          }} />
        </Tabs.Content>

        <Tabs.Content value="account" className="flex flex-col gap-3 data-[state=inactive]:hidden">
          <h2 className="m-0 text-base font-medium">{t('settings.sections.account')}</h2>
          <AccountSection />
          <GiftCode />
          <SocialLink />
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="share-install-stats" className="text-sm font-medium">
                {t('settings.shareStats')}
              </label>
              <span id="share-install-stats-hint" className="text-xs text-text-3">{t('settings.shareStatsHint')}</span>
            </div>
            <Switch
              id="share-install-stats"
              checked={settings.shareInstallStats}
              aria-describedby="share-install-stats-hint"
              onCheckedChange={(v) => void save({ shareInstallStats: v })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="api-url" className="text-sm font-medium">
                {t('settings.apiAddress')}
              </label>
              <span id="api-url-hint" className="text-xs text-text-3">{t('settings.apiHint')}</span>
              <span id="api-url-default" className="text-xs text-text-3">{t('settings.apiDefault', { url: DEFAULT_SETTINGS.apiUrl })}</span>
              {apiOverride && (
                <span id="api-url-override" role="note" className="text-xs text-orange-light">
                  {t('settings.apiOverridden', { url: apiOverride })}
                </span>
              )}
            </div>
            <Input
              id="api-url"
              key={apiOverride ?? settings.apiUrl}
              defaultValue={apiOverride ?? settings.apiUrl}
              disabled={!!apiOverride}
              placeholder={DEFAULT_SETTINGS.apiUrl}
              spellCheck={false}
              className="h-8 w-[260px] bg-background font-mono text-xs"
              aria-describedby={apiOverride ? 'api-url-override' : 'api-url-hint api-url-default api-url-error'}
              aria-invalid={apiError ? true : undefined}
              onChange={() => setApiError(null)}
              onBlur={(e) => {
                const v = e.target.value.trim() || DEFAULT_SETTINGS.apiUrl;
                if (!isHttpUrl(v)) {
                  setApiError(t('settings.apiInvalid'));
                  return;
                }
                setApiError(null);
                if (v !== settings.apiUrl) void save({ apiUrl: v });
                else e.target.value = v;
              }}
            />
            <span id="api-url-error" role="alert" className="basis-full text-xs text-orange-light empty:absolute">
              {apiError}
            </span>
          </div>
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
