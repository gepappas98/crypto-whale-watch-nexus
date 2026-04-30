/* ══ WHALE RADAR v9 — MODAL ══════════════════════════════════════════════════ */

interface WRModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function WRModal({ title, children, onClose }: WRModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/87 z-[500] flex items-center justify-center animate-modal-fade"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-wr-bg2 border border-wr-border border-t-2 border-t-wr-amber max-w-[720px] w-[96%] max-h-[82vh] flex flex-col animate-modal-up">
        <div className="px-4 py-3 border-b border-wr-border bg-wr-bg3 flex items-center justify-between flex-shrink-0">
          <span className="font-head text-[10px] tracking-[3px] text-wr-amber">{title} <span className="pro-badge">PRO</span></span>
          <button className="text-wr-muted hover:text-wr-red text-lg cursor-pointer bg-transparent border-none font-mono" onClick={onClose}>✕</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 scrollbar-thin">
          {children}
        </div>
      </div>
    </div>
  );
}
