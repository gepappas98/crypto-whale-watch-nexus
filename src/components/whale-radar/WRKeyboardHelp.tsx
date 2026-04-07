/* ══ WHALE RADAR v9 — KEYBOARD HELP ══════════════════════════════════════════ */

interface WRKeyboardHelpProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'S', desc: 'Scan now' },
  { key: 'A', desc: 'Toggle AUTO' },
  { key: 'W', desc: 'Watchlist Only' },
  { key: 'H', desc: 'History' },
  { key: 'B', desc: 'Backtest' },
  { key: 'P', desc: 'Portfolio' },
  { key: 'Esc', desc: 'Close modal' },
  { key: '?', desc: 'Toggle this' },
];

export function WRKeyboardHelp({ onClose }: WRKeyboardHelpProps) {
  return (
    <div className="fixed bottom-14 right-4 bg-wr-bg3 border border-wr-border p-3 z-[600] animate-slide-in">
      <div className="font-head text-[8px] text-wr-amber tracking-[2px] mb-2 flex justify-between items-center">
        SHORTCUTS
        <button className="text-wr-muted hover:text-wr-red cursor-pointer bg-transparent border-none font-mono text-sm" onClick={onClose}>✕</button>
      </div>
      {SHORTCUTS.map(s => (
        <div key={s.key} className="flex gap-2 items-center mb-1 text-[8px] text-wr-muted tracking-widest">
          <span className="inline-block px-1.5 py-0 border border-wr-border text-wr-green-dim bg-wr-bg text-[8px]">{s.key}</span>
          {s.desc}
        </div>
      ))}
    </div>
  );
}
