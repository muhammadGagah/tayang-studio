import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Project, Style } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  assetUrl: (p: string) => p,
  attachFile: vi.fn(),
  detectAgents: vi.fn().mockResolvedValue([]),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import { Composer } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { setUiLanguage } from '@/i18n';
import { styleContext } from '@/lib/mentions';
import { useChat } from '@/state/chat';

const atlas: Style = {
  id: 'builtin-atlas',
  name: 'Atlas journey',
  source: 'builtin',
  sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  notes: { camera: 'Slow push-ins on the map', pacing: '', color: 'Navy and paper white' },
  prompt: 'Animate a journey across a paper map.',
  createdAt: '',
  previewUrl: 'https://cdn.tayang.app/atlas.jpg',
  previewVideoUrl: 'https://cdn.tayang.app/atlas.mp4',
  template: { sha256: 'a', size: 1, version: 1 },
};
const copied: Style = { ...atlas, id: 'copied-1', name: 'Bold captions', source: 'copied', previewUrl: null, template: null };
const mine: Style = { ...atlas, id: 'mine-1', name: 'Mine', source: 'mine', sourceUrl: null, previewUrl: null, template: null };

const project: Project = {
  id: 'p1',
  title: 'Kenapa rupiah melemah?',
  slug: 'p1',
  folder: '/tmp/p1',
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status: 'draft',
  styleId: null,
  scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null,
  createdAt: '',
  updatedAt: '',
};

describe('styleContext', () => {
  it('sends the prompt and the non-empty notes, the template line, and no URLs', () => {
    const out = styleContext([{ type: 'style-mention', styleId: 'builtin-atlas', name: 'Atlas journey' }], [atlas]);
    expect(out).toHaveLength(1);
    const text = out[0]!.type === 'text' ? out[0]!.text : '';
    expect(text).toBe(
      [
        'Use the style "Atlas journey" for this video:',
        'Animate a journey across a paper map.',
        'Camera: Slow push-ins on the map',
        'Color: Navy and paper white',
        'This style has a starter template; Tayang sets it up when a new video starts from it.',
        'Its Tayang style id is "builtin-atlas": put exactly this id in a topic card\'s styleId.',
      ].join('\n'),
    );
    expect(text).not.toMatch(/https?:/);
  });

  it('drops links that a prompt or a note quotes', () => {
    const quoting: Style = {
      ...mine,
      prompt: 'Like https://www.tiktok.com/@a/video/1 but calmer.',
      notes: { camera: 'Handheld, see http://example.com/x', pacing: 'https://only.a/link' },
    };
    const out = styleContext([{ type: 'style-mention', styleId: 'mine-1', name: 'Mine' }], [quoting]);
    const text = out[0]!.type === 'text' ? out[0]!.text : '';
    expect(text).not.toMatch(/https?:|example\.com/);
    expect(text).toContain('Like but calmer.');
    expect(text).toContain('Camera: Handheld, see');
    expect(text).not.toContain('Pacing:');
  });

  it('leaves out the template line for a style without one, and skips styles it does not know', () => {
    const plain: Style = { ...mine, notes: {} };
    const out = styleContext(
      [
        { type: 'style-mention', styleId: 'mine-1', name: 'Mine' },
        { type: 'style-mention', styleId: 'gone', name: 'Gone' },
        { type: 'text', text: 'halo' },
      ],
      [plain],
    );
    expect(out).toEqual([
      {
        type: 'text',
        text: 'Use the style "Mine" for this video:\nAnimate a journey across a paper map.\nIts Tayang style id is "mine-1": put exactly this id in a topic card\'s styleId.',
      },
    ]);
  });
});

describe('the @ menu with styles', () => {
  const setup = (props: Partial<React.ComponentProps<typeof Composer>> = {}) => {
    const onSend = vi.fn().mockResolvedValue(true);
    const utils = render(<Composer chatId={null} onSend={onSend} projects={[project]} styles={[atlas, copied, mine]} {...props} />);
    return { onSend, ...utils };
  };

  it('shows videos and styles in two groups, each style with its picture and where it comes from', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '@');
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Videos')).toBeInTheDocument();
    expect(within(list).getByText('Styles')).toBeInTheDocument();
    const atlasRow = within(list).getByRole('option', { name: /Atlas journey/ });
    expect(atlasRow).toHaveTextContent('Built in');
    expect(atlasRow.querySelector('img')).toHaveAttribute('src', 'https://cdn.tayang.app/atlas.jpg');
    // A copied style without its own preview shows its video's thumbnail; one without either, a swatch.
    expect(within(list).getByRole('option', { name: /Bold captions/ }).querySelector('img')).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    );
    expect(within(list).getByRole('option', { name: /Bold captions/ })).toHaveTextContent('Copied from a video');
    expect(within(list).getByRole('option', { name: /Mine/ })).toHaveTextContent('Yours');
    expect(within(within(list).getByRole('option', { name: /Mine/ })).getByTestId('style-swatch')).toBeInTheDocument();
  });

  it('the footer says pick, which fits a video and a style alike', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '@');
    await screen.findByRole('listbox');
    expect(screen.getByText('pick')).toBeInTheDocument();
    expect(screen.queryByText('attach')).not.toBeInTheDocument();
  });

  it('opens from the toolbar and keeps the composer focused after a pointer selection', async () => {
    const user = userEvent.setup();
    setup();
    const button = screen.getByRole('button', { name: '@ Mention a video' });
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.click(button);
    const list = screen.getByRole('listbox');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveFocus();
    await user.click(within(list).getByRole('option', { name: /Atlas journey/ }));
    expect(screen.getByText('@Atlas journey')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(box).toHaveFocus();
  });

  it('filters both groups by the query', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '@atl');
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Atlas journey')]);
    expect(within(list).getByText('No videos match')).toBeInTheDocument();
  });

  it('arrow keys move across the groups and Enter picks a style as a chip', async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box).toHaveAccessibleDescription(/Shift\+Enter for a new line.*Type @ for suggestions/);
    await user.type(box, 'pakai @');
    const list = await screen.findByRole('listbox', { name: 'Mention a video or style' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(box).toHaveAttribute('aria-controls', list.id);
    const firstOption = within(list).getByRole('option', { name: /Kenapa rupiah/, selected: true });
    expect(box).toHaveAttribute('aria-activedescendant', firstOption.id);
    await user.keyboard('{ArrowDown}');
    const atlasOption = within(list).getByRole('option', { name: /Atlas journey/, selected: true });
    expect(box).toHaveAttribute('aria-activedescendant', atlasOption.id);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(within(list).getByRole('option', { name: /Mine/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByText('@Atlas journey')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove the Atlas journey style' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Added Atlas journey to the message.');
    expect(box).toHaveValue('pakai ');
    expect(box).toHaveFocus();
    expect(box).not.toHaveAttribute('aria-activedescendant');
    await user.type(box, 'ini');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith([
      { type: 'text', text: 'pakai ini' },
      { type: 'style-mention', styleId: 'builtin-atlas', name: 'Atlas journey' },
    ]);
    expect(screen.queryByText('@Atlas journey')).not.toBeInTheDocument();
  });

  it('keeps composing on IME Enter and dismisses suggestions without moving focus on Escape', async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, '@atl');
    expect(fireEvent.keyDown(box, { key: 'Enter', isComposing: true })).toBe(true);
    expect(box).toHaveValue('@atl');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.compositionStart(box);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(box);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(box).toHaveFocus();
    expect(box).not.toHaveAttribute('aria-activedescendant');
    expect(document.getElementById(box.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('allows a new line with suggestions open and closes the list when focus leaves', async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, '@atl');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(box).toHaveValue('@atl\n');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.type(box, '@mine');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Attach files' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps focus on another control when the composer becomes enabled again', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const view = (disabled = false) => (
      <>
        <button type="button">Open another conversation</button>
        <Composer chatId={null} onSend={onSend} autoFocus disabled={disabled} />
      </>
    );
    const { rerender } = render(view());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
    rerender(view(true));
    const other = screen.getByRole('button', { name: 'Open another conversation' });
    await user.click(other);
    rerender(view());
    expect(other).toHaveFocus();
  });

  it('shows the hint under the style chip when asked to', async () => {
    const user = userEvent.setup();
    setup({ projects: undefined, styleHint: 'This style is used for this message' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '@');
    const list = await screen.findByRole('listbox');
    // A project chat lists styles only.
    expect(within(list).queryByText('Videos')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByText('This style is used for this message')).toBeInTheDocument();
  });

  it('a draft keeps its style chip', async () => {
    useChat.getState().reset();
    const user = userEvent.setup();
    const { unmount } = setup({ draftKey: 'new' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'pakai @mine');
    await user.keyboard('{Enter}');
    unmount();
    expect(useChat.getState().drafts.new).toEqual({ text: 'pakai ', style: { styleId: 'mine-1', name: 'Mine' } });
    setup({ draftKey: 'new' });
    expect(screen.getByText('@Mine')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('pakai ');
  });

  it('speaks Indonesian', async () => {
    setUiLanguage('id');
    const user = userEvent.setup();
    setup({ styleHint: undefined });
    await user.type(screen.getByRole('textbox', { name: 'Pesan' }), '@zzz');
    expect(screen.getByText('Gaya')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada gaya yang cocok')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Tidak ada/);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('a sent style mention', () => {
  const user = (parts: ChatMessage['parts']): ChatMessage => ({ id: 'm1', chatId: 'c', role: 'user', parts, createdAt: '' });

  it('renders as a style chip next to the text, and old messages still render', async () => {
    render(
      <MessageList
        streaming={false}
        messages={[
          user([{ type: 'text', text: 'lama' }, { type: 'mention', projectId: 'p1', title: 'Kenapa rupiah melemah?' }]),
          { ...user([{ type: 'text', text: 'baru' }, { type: 'style-mention', styleId: 'builtin-atlas', name: 'Atlas journey' }]), id: 'm2' },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByText('@Atlas journey')).toBeInTheDocument());
    expect(screen.getByText('@Atlas journey').closest('[data-chip="style"]')).not.toBeNull();
    expect(screen.getByText('@Kenapa rupiah melemah?')).toBeInTheDocument();
    expect(screen.getByText('lama')).toBeInTheDocument();
  });
});
