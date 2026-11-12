// Chrome tells the page when the app can be installed to the home screen.
// We hold on to that offer so the library can show its own "Install" button,
// instead of relying on the user finding the option in Chrome's menu.

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  offer = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  offer = null;
  notify();
});

export function canInstall(): boolean {
  return offer !== null;
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Shows Chrome's install dialog. The offer can only be used once. */
export async function promptInstall(): Promise<void> {
  const current = offer;
  if (!current) return;
  offer = null;
  notify();
  await current.prompt().catch(() => {});
}
