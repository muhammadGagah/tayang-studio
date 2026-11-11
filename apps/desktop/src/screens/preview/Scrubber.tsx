import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTimecode } from '@tayang/shared';
import { cn } from '@/lib/utils';

export interface Scene {
  name: string;
  startSec: number;
  endSec: number;
  /** Unbuilt scenes are drawn hatched. Defaults to built. */
  built?: boolean;
}

export interface ScrubberProps {
  durationSec: number;
  fps: number;
  frame: number;
  thumbnails: string[];
  onSeek(frame: number): void;
  scenes?: Scene[];
}

const HATCH = 'repeating-linear-gradient(135deg, #1A1A1A 0 6px, #202020 6px 12px)';

export function Scrubber({ durationSec, fps, frame, thumbnails, onSeek, scenes }: ScrubberProps) {
  const { t } = useTranslation();
  const total = Math.max(1, Math.round(durationSec * fps));
  const last = total - 1;
  const instructionsId = useId();
  const ref = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  /** The frame under the pointer while it hovers the strip without pressing. */
  const [hover, setHover] = useState<number | null>(null);

  const clamp = (f: number) => Math.min(last, Math.max(0, f));
  const pctOf = (f: number) => (last > 0 ? (f / last) * 100 : 0);
  const sceneAt = (sec: number) => scenes?.find((s) => sec < s.endSec) ?? scenes?.at(-1);
  const scene = sceneAt(frame / fps);
  const time = formatTimecode(frame / fps, fps);

  // The bubble follows the hover, otherwise the playhead.
  const shown = hover ?? frame;
  const shownScene = sceneAt(shown / fps);
  const shownTime = formatTimecode(shown / fps, fps);
  const pct = pctOf(frame);
  const bubblePct = pctOf(shown);

  const frameFromX = (clientX: number): number | null => {
    const r = ref.current!.getBoundingClientRect();
    if (r.width <= 0) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return clamp(Math.round(ratio * last));
  };
  const seekFromX = (clientX: number) => {
    const f = frameFromX(clientX);
    if (f !== null) onSeek(f);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? Math.max(1, Math.round(fps)) : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = frame + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = frame - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onSeek(clamp(next));
  };

  return (
    <div className="relative pt-7">
      <span id={instructionsId} className="sr-only">{t('preview.timelineKeys')}</span>
      {/* Sits on the playhead (or the hover) and slides along it, so it never leaves the strip. */}
      <div
        aria-hidden="true"
        data-testid="scrubber-bubble"
        className="pointer-events-none absolute top-0 whitespace-nowrap rounded-md border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] leading-4 tabular-nums text-foreground"
        style={{ left: `${bubblePct}%`, transform: `translateX(-${bubblePct}%)` }}
      >
        {shownScene ? `${shownTime} · ${shownScene.name}` : shownTime}
      </div>
      <div className="relative flex h-12 gap-0.5 overflow-hidden rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
        <input
          ref={ref}
          type="range"
          min={0}
          max={last}
          value={frame}
          aria-label={t('preview.framesAria')}
          aria-describedby={instructionsId}
          aria-valuetext={scene ? `${time} · ${scene.name}` : time}
          onChange={(e) => onSeek(e.currentTarget.valueAsNumber)}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            // Use the full strip for pointer seeking, including its edges.
            e.preventDefault();
            e.currentTarget.focus();
            dragging.current = true;
            setHover(null);
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seekFromX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging.current) seekFromX(e.clientX);
            else if (e.pointerType !== 'touch') setHover(frameFromX(e.clientX));
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => (dragging.current = false)}
          onLostPointerCapture={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer touch-none opacity-0"
        />
        {thumbnails.map((src, i) => {
          const sec = ((i + 0.5) / thumbnails.length) * durationSec;
          const built = sceneAt(sec)?.built !== false;
          return (
            <div
              key={src + i}
              className="min-w-0 flex-1 bg-cover bg-center"
              style={built ? { backgroundImage: `url("${src}")` } : { backgroundImage: HATCH }}
            />
          );
        })}
      </div>
      {hover !== null && (
        <div
          aria-hidden="true"
          data-testid="scrubber-hover"
          className="pointer-events-none absolute top-7 h-12 w-px -translate-x-1/2 bg-foreground/40"
          style={{ left: `${bubblePct}%` }}
        />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-7 h-12 w-0.5 -translate-x-1/2 bg-foreground"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute -left-1.5 -top-1 flex h-4 w-3.5 items-center justify-center gap-0.5 rounded-sm bg-foreground">
          <span className="h-2 w-px bg-text-3" />
          <span className="h-2 w-px bg-text-3" />
        </div>
      </div>
      {scenes && scenes.length > 0 && (
        <div className="mt-2 flex gap-0.5">
          {scenes.map((s) => (
            <span
              key={s.name + s.startSec}
              className={cn('min-w-0 truncate text-[11px]', s === scene ? 'text-foreground' : 'text-text-3')}
              style={{ flex: `${s.endSec - s.startSec} 1 0` }}
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
