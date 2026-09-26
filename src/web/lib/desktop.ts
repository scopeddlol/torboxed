import '../../shared/bridge';

export const desktop = typeof window !== 'undefined' ? (window.torboxed ?? null) : null;
export const isDesktop = !!desktop;

export async function copyText(text: string): Promise<boolean> {
  try {
    if (desktop) await desktop.clipboard.writeText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure (plain http) contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function readClipboard(): Promise<string | null> {
  try {
    if (desktop) return await desktop.clipboard.readText();
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export const canReadClipboard = isDesktop || (typeof navigator !== 'undefined' && !!navigator.clipboard?.readText && window.isSecureContext);
