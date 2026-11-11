import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project, Style } from '@tayang/shared';
import { i18n } from '@/i18n';
import { swatch } from '@/components/NoPreview';
import { posterOf, styleSource } from '@/lib/styleInfo';

function meta(p: Project) {
  const status = i18n.t(`mention.status.${p.status}`);
  if (p.durationSec == null) return status;
  const s = Math.round(p.durationSec);
  return `${status} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  return q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects;
}

export function filterStyles(styles: Style[], query: string): Style[] {
  const q = query.trim().toLowerCase();
  return q ? styles.filter((s) => s.name.toLowerCase().includes(q)) : styles;
}

/** The menu's value for an item: videos and styles share one list the arrow keys move through. */
export const videoKey = (p: Pick<Project, 'id'>) => `video:${p.id}`;
export const styleKey = (s: Pick<Style, 'id'>) => `style:${s.id}`;
export const mentionOptionId = (listId: string, key: string) => `${listId}-${encodeURIComponent(key)}`;

/** A 9:16 mini of the style: its picture, or its swatch. */
function StyleThumb({ style }: { style: Style }) {
  const src = posterOf(style);
  if (src) return <img src={src} alt="" aria-hidden="true" className="h-9 w-5 shrink-0 rounded-xs border border-hairline object-cover" />;
  const [bg, fg] = swatch(style.id);
  return (
    <span
      aria-hidden="true"
      data-testid="style-swatch"
      className="h-9 w-5 shrink-0 rounded-xs border border-hairline"
      style={{ background: `linear-gradient(160deg, ${bg} 60%, ${fg})` }}
    />
  );
}

/**
 * The list inside the @ popover: videos, then styles. Leave `projects` or `styles` out to leave out its
 * group. The textarea keeps focus and drives `value` with the arrow keys.
 */
export function MentionMenu({
  id,
  projects,
  styles,
  query,
  value,
  onValueChange,
  onPick,
  onPickStyle,
}: {
  id: string;
  projects?: Project[];
  styles?: Style[];
  /** What was typed after @: an empty group then says nothing matches rather than that there is nothing. */
  query: string;
  value: string;
  onValueChange(key: string): void;
  onPick(p: Project): void;
  onPickStyle(s: Style): void;
}) {
  const { t } = useTranslation();
  useLayoutEffect(() => {
    if (value) document.getElementById(mentionOptionId(id, value))?.scrollIntoView({ block: 'nearest' });
  }, [id, value]);

  const empty = (none: string, noMatch: string) => (
    <div aria-hidden="true" className="px-2 py-3 text-[13px] text-text-3">{query.trim() ? noMatch : none}</div>
  );
  const option = (key: string, pick: () => void): React.ComponentProps<'div'> => ({
    id: mentionOptionId(id, key),
    role: 'option',
    'aria-selected': key === value,
    onPointerMove: () => onValueChange(key),
    onMouseDown: (e) => e.preventDefault(),
    onClick: pick,
    className: 'flex h-12 cursor-default select-none items-center gap-3 rounded-sm px-2 aria-selected:bg-accent aria-selected:text-accent-foreground aria-selected:outline-solid aria-selected:outline-2 aria-selected:-outline-offset-2 aria-selected:outline-ring forced-colors:aria-selected:outline-[Highlight]',
  });
  const groupHeading = 'px-2 py-1.5 text-xs font-medium text-muted-foreground';
  return (
    <>
      <div
        id={value ? id : undefined}
        role={value ? 'listbox' : undefined}
        aria-label={value ? t('mention.aria') : undefined}
        tabIndex={-1}
        className="max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto"
      >
        {projects && (
          <div role={projects.length ? 'group' : undefined} aria-labelledby={projects.length ? `${id}-videos` : undefined} className="p-1">
            <div id={`${id}-videos`} aria-hidden="true" className={groupHeading}>{t('mention.videos')}</div>
            {projects.length === 0 && empty(t('mention.none'), t('mention.noVideosMatch'))}
            {projects.map((p) => (
              <div key={p.id} {...option(videoKey(p), () => onPick(p))}>
                <span aria-hidden="true" className="h-9 w-5 shrink-0 rounded-xs border border-hairline bg-raised" />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[13px] font-medium">{p.title}</span>
                  <span className="text-xs text-text-3">{meta(p)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {styles && (
          <div role={styles.length ? 'group' : undefined} aria-labelledby={styles.length ? `${id}-styles` : undefined} className="p-1">
            <div id={`${id}-styles`} aria-hidden="true" className={groupHeading}>{t('mention.styles')}</div>
            {styles.length === 0 && empty(t('mention.noStyles'), t('mention.noStylesMatch'))}
            {styles.map((s) => (
              <div key={s.id} {...option(styleKey(s), () => onPickStyle(s))}>
                <StyleThumb style={s} />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[13px] font-medium">{s.name}</span>
                  <span className="text-xs text-text-3">{styleSource(s)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div aria-hidden="true" className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-xs text-text-3">
        {['↑', '↓'].map((k) => (
          <kbd key={k} className="rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">
            {k}
          </kbd>
        ))}
        <span>{t('mention.move')}</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">↵</kbd>
        <span>{t('mention.attach')}</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">Esc</kbd>
        <span>{t('mention.close')}</span>
      </div>
    </>
  );
}
