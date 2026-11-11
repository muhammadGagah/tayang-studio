import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard, X } from 'lucide-react';
import { FileView } from '@/components/workspace/FileView';
import { useProjectTabs, useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/utils';

/**
 * The project chat's second pane: the video preview, plus a tab for each file opened from the file
 * sidebar. The preview stays mounted while a file is shown, so the video keeps its place.
 */
export function Workspace({ projectId, reloadKey, preview }: { projectId: string; reloadKey: number; preview: ReactNode }) {
  const { t } = useTranslation();
  const { files, active } = useProjectTabs(projectId);
  const show = useWorkspace((s) => s.show);
  const close = useWorkspace((s) => s.close);
  const id = useId();
  const [focused, setFocused] = useState<string | null | undefined>(undefined);
  const tabStop = focused === null || (focused !== undefined && files.includes(focused)) ? focused : active;
  const tabs = [null, ...files];
  const tabId = (key: string | null) => `${id}-tab-${encodeURIComponent(key ?? '')}`;
  const panelId = (key: string | null) => `${id}-panel-${encodeURIComponent(key ?? '')}`;
  const focusTab = (key: string | null) => document.getElementById(tabId(key))?.focus();

  const closeFile = (path: string, restoreFocus: boolean) => {
    if (restoreFocus) {
      const index = files.indexOf(path);
      focusTab(files[index + 1] ?? files[index - 1] ?? null);
    }
    close(projectId, path);
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string | null) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const index = tabs.indexOf(key);
    if (e.key === 'ArrowLeft') focusTab(tabs[(index + tabs.length - 1) % tabs.length]!);
    else if (e.key === 'ArrowRight') focusTab(tabs[(index + 1) % tabs.length]!);
    else if (e.key === 'Home') focusTab(null);
    else if (e.key === 'End') focusTab(files.at(-1) ?? null);
    else if (e.key === 'Delete' && key !== null) closeFile(key, true);
    else return;
    e.preventDefault();
  };

  const tab = (key: string | null, label: ReactNode, title: string, closable: boolean) => {
    const selected = active === key;
    const descriptionId = `${id}-description-${encodeURIComponent(key ?? '')}`;
    return (
      <div
        key={key ?? '__preview'}
        className={cn(
          'group flex h-full max-w-48 shrink-0 items-center border-r border-border',
          selected ? 'bg-[#101010] text-foreground' : 'text-text-3 hover:text-foreground',
        )}
      >
        <button
          id={tabId(key)}
          type="button"
          role="tab"
          tabIndex={tabStop === key ? 0 : -1}
          aria-selected={selected}
          aria-controls={panelId(key)}
          aria-keyshortcuts={closable ? 'Delete' : undefined}
          aria-describedby={closable ? descriptionId : undefined}
          title={title}
          onFocus={() => setFocused(key)}
          onKeyDown={(e) => onTabKeyDown(e, key)}
          onClick={() => show(projectId, key)}
          // Middle click closes a file tab, like an editor.
          onAuxClick={(e) => closable && key && e.button === 1 && closeFile(key, document.activeElement === e.currentTarget)}
          className={cn('flex h-full min-w-0 cursor-pointer items-center gap-1.5 text-[13px]', closable ? 'pl-3' : 'px-3')}
        >
          {label}
          {closable && key && (
            <span
              aria-hidden="true"
              title={t('workspace.close', { name: title })}
              onClick={(e) => {
                e.stopPropagation();
                closeFile(key, true);
              }}
              className={cn(
                'mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-raised',
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
              )}
            >
              <X size={12} />
            </span>
          )}
        </button>
        {closable && (
          <span id={descriptionId} hidden>{key?.includes('/') && `${title}. `}{t('workspace.closeTabTip')}</span>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={t('workspace.tabs')}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(undefined); }}
        className="no-scrollbar flex h-9 shrink-0 overflow-x-auto border-b border-border bg-sidebar"
      >
        {tab(
          null,
          <>
            <Clapperboard size={14} strokeWidth={1.5} aria-hidden="true" />
            {t('workspace.preview')}
          </>,
          t('workspace.preview'),
          false,
        )}
        {files.map((p) => tab(p, <span className="truncate">{p.split('/').pop()}</span>, p, true))}
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((key) => (
          <div
            key={panelId(key)}
            id={panelId(key)}
            role="tabpanel"
            aria-labelledby={tabId(key)}
            tabIndex={0}
            hidden={active !== key}
            className="h-full"
          >
            {key === null ? preview : key === active && <FileView projectId={projectId} path={key} reloadKey={reloadKey} />}
          </div>
        ))}
      </div>
    </div>
  );
}
