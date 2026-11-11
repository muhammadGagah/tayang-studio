import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useApp } from '@/state/app';

function Example({ onConfirm, onCloseAutoFocus }: { onConfirm?(): void; onCloseAutoFocus?(): void }) {
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  return (
    <main id="main-content" tabIndex={-1}>
      {!removed && <button onClick={() => setOpen(true)}>Open settings</button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Settings dialog</DialogTitle>
          <button onClick={() => {
            if (onConfirm) onConfirm();
            else setRemoved(true);
            setOpen(false);
          }}>Confirm</button>
        </DialogContent>
      </Dialog>
    </main>
  );
}

it('marks the open dialog modal and returns focus to its external opener on Escape', async () => {
  const user = userEvent.setup();
  render(<Example />);
  const opener = screen.getByRole('button', { name: 'Open settings' });
  opener.focus();
  await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'Settings dialog' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(opener).toHaveFocus());
});

it.each(['removed opener', 'route change'])('focuses main after closing with %s', async (reason) => {
  const user = userEvent.setup();
  const previous = useApp.getState().route;
  try {
    render(<Example onConfirm={reason === 'route change' ? () => useApp.setState({ route: { name: 'videos' } }) : undefined} />);
    const main = screen.getByRole('main');
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(main).toHaveFocus());
  } finally {
    useApp.setState({ route: previous });
  }
});

it('preserves focus placed by the caller after close', async () => {
  const user = userEvent.setup();
  render(<Example onCloseAutoFocus={() => document.getElementById('main-content')?.focus()} />);
  const main = screen.getByRole('main');
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(main).toHaveFocus());
});
