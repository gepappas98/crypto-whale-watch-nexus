import { useState } from 'react';
import { isHLConfigured } from '@/lib/hyperliquid';

interface HLConfigBannerProps {
  onOpenSettings: () => void;
}

export function HLConfigBanner({ onOpenSettings }: HLConfigBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (isHLConfigured() || dismissed) return null;

  return (
    <div className="bg-wr-amber/10 border border-wr-amber/30 rounded-lg p-3 mb-4 flex items-start gap-3">
      <span className="text-wr-amber text-lg">⚠️</span>
      <div className="flex-1">
        <p className="text-sm font-medium text-wr-amber">
          Hyperliquid block explorer not configured
        </p>
        <p className="text-xs text-wr-muted mt-1">
          Perpetual trading data works without setup. Configure Supabase to enable
          block explorer (blocks, txs, wallet tracking).
        </p>
        <button
          onClick={onOpenSettings}
          className="text-xs text-wr-cyan hover:underline mt-2"
        >
          Open Settings →
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-wr-muted hover:text-wr-text"
      >
        ✕
      </button>
    </div>
  );
}
