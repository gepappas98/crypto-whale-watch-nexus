/* ══ WHALE RADAR v9 — MOBILE FILTER BOTTOM SHEET ═════════════════════════════
 *  Drawer-based filter panel for mobile viewports.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { WRAdvancedFilters, type WhaleFilters } from './WRAdvancedFilters';

interface WRMobileFilterSheetProps {
  filters: WhaleFilters;
  onChange: (filters: WhaleFilters) => void;
  vmcapThr: number;
  pchgThr: number;
  onVmcapChange: (v: number) => void;
  onPchgChange: (v: number) => void;
}

export function WRMobileFilterSheet({
  filters, onChange, vmcapThr, pchgThr, onVmcapChange, onPchgChange,
}: WRMobileFilterSheetProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button className="wr-btn text-[8px] px-2 py-1 lg:hidden min-h-[44px] min-w-[44px]">
          ⚙ FILTERS
        </button>
      </DrawerTrigger>
      <DrawerContent className="bg-wr-bg2 border-t border-wr-border">
        <DrawerHeader className="pb-0">
          <DrawerTitle className="text-[10px] tracking-[0.2em] text-wr-green font-mono">
            ⬡ ADVANCED FILTERS
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-4">
          <WRAdvancedFilters filters={filters} onChange={onChange} />
          
          {/* Threshold sliders */}
          <div className="space-y-3 border-t border-wr-border pt-3">
            <div className="text-[7px] text-wr-muted tracking-[0.2em]">SCANNER THRESHOLDS</div>
            <div className="flex items-center gap-3">
              <label className="text-[9px] text-wr-green-dim tracking-widest w-20">VOL/MCAP≥</label>
              <input
                type="range"
                className="flex-1 h-1 accent-wr-green"
                min={50} max={1000} step={25}
                value={vmcapThr}
                onChange={e => onVmcapChange(+e.target.value)}
              />
              <span className="text-[10px] text-wr-amber w-12 text-right">{vmcapThr}%</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[9px] text-wr-green-dim tracking-widest w-20">24H CHG≥</label>
              <input
                type="range"
                className="flex-1 h-1 accent-wr-green"
                min={5} max={60} step={5}
                value={pchgThr}
                onChange={e => onPchgChange(+e.target.value)}
              />
              <span className="text-[10px] text-wr-amber w-12 text-right">{pchgThr}%</span>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
