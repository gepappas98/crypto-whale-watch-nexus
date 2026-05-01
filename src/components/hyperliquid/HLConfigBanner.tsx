/* ══ HYPERLIQUID — Config Banner ══════════════════════════════════════════════
 *  Shown once at the top of the app when Supabase is not configured.
 *  Dismissable (survives the session, not persisted — reappears on reload
 *  until properly configured to keep reminding the user).
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { isHLConfigured } from '@/lib/hyperliquid';

interface HLConfigBannerProps {
  onOpenSettings: () => void;
}

export function HLConfigBanner({ onOpenSettings }: HLConfigBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Already configured — never render
  if (isHLConfigured() || dismissed) return null;

  return (
    <div className="bg-wr-cyan/8 border-b border-wr-cyan/30 px-4 py-1.5 flex items-center gap-3 text-[8px] font-mono tracking-widest animate-slide-in">
      <span className="w-1.5 h-1.5 rounded-full bg-wr-cyan/60 flex-shrink-0" />
      <span className="text-wr-cyan/80">
        🔗 HYPERLIQUID EXPLORER &amp; SCANNER not configured —
      </span>
      <button
        className="text-wr-cyan underline hover:text-wr-white transition-colors cursor-pointer bg-transparent border-none font-mono"
        onClick={() => { onOpenSettings(); }}
      >
        Open Settings → add Supabase URL &amp; key
      </button>
      <div className="flex-1" />
      <button
        className="text-wr-muted/50 hover:text-wr-muted cursor-pointer bg-transparent border-none font-mono text-[9px]"
        onClick={() => setDismissed(true)}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
