// src/components/whale-radar/WRInsiderRiskScanner.tsx (Enhanced)
// This is an updated version with full API integration

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Shield, AlertTriangle, AlertOctagon, CheckCircle, HelpCircle,
  RefreshCw, Download, ChevronDown, ChevronUp,
  Database, Activity, Lock, Unlock, Building2,
  ArrowRightLeft, TrendingUp, AlertCircle, Zap
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  InsiderRiskData, 
  RISK_WEIGHTS,
  DEFAULT_CEX_ADDRESSES 
} from '@/types/insiderRisk';
import { 
  calculateRiskScore, 
  exportInsiderRiskCSV,
  formatTokenAmount 
} from '@/lib/insiderRiskUtils';
import { analyzeTokenRisk } from '@/lib/insiderRiskApi';
import WRInsiderProgress from './WRInsiderProgress';
import type { CoinData } from '@/lib/whaleRadarState';

interface WRInsiderRiskScannerProps {
  coins: CoinData[];
  isScanning: boolean;
  etherscanKey: string;
  birdeyeKey: string;
  onRefresh: () => void;
  lastScanTime: number;
}

// Risk Badge Component
const RiskBadge: React.FC<{ level: string; score: number }> = ({ level, score }) => {
  const config = {
    CRITICAL: { 
      cls: 'bg-[hsl(var(--wr-pink))]/20 border-[hsl(var(--wr-pink))] text-[hsl(var(--wr-pink))]',
      icon: AlertOctagon,
      label: 'CRITICAL'
    },
    HIGH: { 
      cls: 'bg-[hsl(var(--wr-amber))]/20 border-[hsl(var(--wr-amber))] text-[hsl(var(--wr-amber))]',
      icon: AlertTriangle,
      label: 'HIGH'
    },
    MEDIUM: { 
      cls: 'bg-[hsl(var(--wr-cyan))]/15 border-[hsl(var(--wr-cyan))]/60 text-[hsl(var(--wr-cyan))]',
      icon: AlertCircle,
      label: 'MEDIUM'
    },
    LOW: { 
      cls: 'bg-[hsl(var(--wr-green))]/10 border-[hsl(var(--wr-green))]/40 text-[hsl(var(--wr-green))]',
      icon: CheckCircle,
      label: 'LOW'
    },
    // Real scan failure (API error, no data) — was previously indistinguishable
    // from LOW risk because the fallback below defaulted any unrecognized
    // level to the green LOW/checkmark badge. A failed scan is not the same
    // claim as "we checked and it's low risk" and must never render like one.
    UNKNOWN: {
      cls: 'bg-white/5 border-white/20 text-wr-muted',
      icon: HelpCircle,
      label: 'NO DATA',
    },
  };

  // Was `|| config.LOW` — meant any unrecognized/missing level silently
  // rendered as a reassuring green "LOW ✓" badge. An unrecognized level is
  // exactly the failure case that must NOT look like a clean bill of health.
  const cfg = config[level as keyof typeof config] || config.UNKNOWN;
  const Icon = cfg.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border ${cfg.cls} ${
      level === 'CRITICAL' ? 'animate-pulse shadow-[0_0_12px_hsl(var(--wr-pink)/0.3)]' : ''
    }`}>
      <Icon className="w-3 h-3" />
      <span className="text-[10px] font-bold tracking-wider">{cfg.label}</span>
      {level !== 'UNKNOWN' && <span className="text-[10px] opacity-70">({score})</span>}
    </div>
  );
};

// Flag Badge Component
type FlagKey = keyof InsiderRiskData['flags'];

const FlagBadge: React.FC<{ type: FlagKey | string; active: boolean; details?: string }> = ({ 
  type, active, details 
}) => {
  if (!active) return null;

  const flags: Record<string, { icon: string; label: string; color: string }> = {
    lowCirculating: { 
      icon: '🔴', 
      label: 'LOW CIRCULATING', 
      color: 'text-[hsl(var(--wr-red))] border-[hsl(var(--wr-red))]/40 bg-[hsl(var(--wr-red))]/10' 
    },
    extremeTeamControl: { 
      icon: '🚨', 
      label: 'EXTREME CONTROL', 
      color: 'text-[hsl(var(--wr-pink))] border-[hsl(var(--wr-pink))]/40 bg-[hsl(var(--wr-pink))]/20' 
    },
    highConcentration: { 
      icon: '⚠️', 
      label: 'HIGH CONCENTRATION', 
      color: 'text-[hsl(var(--wr-amber))] border-[hsl(var(--wr-amber))]/40 bg-[hsl(var(--wr-amber))]/10' 
    },
    prePumpCEX: { 
      icon: '🔥', 
      label: 'PRE-PUMP DETECTED', 
      color: 'text-[hsl(var(--wr-pink))] border-[hsl(var(--wr-pink))]/40 bg-[hsl(var(--wr-pink))]/20' 
    },
    gnosisSafe: { 
      icon: '🔴', 
      label: 'GNOSIS SAFE', 
      color: 'text-[hsl(var(--wr-purple))] border-[hsl(var(--wr-purple))]/40 bg-[hsl(var(--wr-purple))]/10' 
    },
    largeCEXTransfers: { 
      icon: '💰', 
      label: 'CEX TRANSFERS', 
      color: 'text-[hsl(var(--wr-cyan))] border-[hsl(var(--wr-cyan))]/40 bg-[hsl(var(--wr-cyan))]/10' 
    },
  };

  const flag = flags[type];
  if (!flag) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-medium ${flag.color} ${
            type === 'prePumpCEX' || type === 'extremeTeamControl' ? 'animate-pulse' : ''
          }`}>
            <span>{flag.icon}</span>
            <span className="hidden sm:inline">{flag.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-[hsl(var(--wr-bg2))] border-[hsl(var(--wr-border))] text-[hsl(var(--wr-white))] max-w-xs">
          <p className="text-[10px]">{details || flag.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// Risk Meter Component
const RiskMeter: React.FC<{ score: number }> = ({ score }) => {
  const percentage = Math.min(100, Math.max(0, score));
  const getColor = () => {
    if (score >= 70) return 'hsl(var(--wr-pink))';
    if (score >= 40) return 'hsl(var(--wr-amber))';
    if (score >= 10) return 'hsl(var(--wr-cyan))';
    return 'hsl(var(--wr-green))';
  };

  return (
    <div className="w-full max-w-[100px]">
      <div className="flex justify-between text-[8px] text-[hsl(var(--wr-muted))] mb-1">
        <span>RISK</span>
        <span className="font-mono font-bold" style={{ color: getColor() }}>{score}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[hsl(var(--wr-bg3))] overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-500"
          style={{ 
            width: `${percentage}%`,
            background: score >= 70 
              ? 'linear-gradient(90deg, hsl(var(--wr-red)) 0%, hsl(var(--wr-pink)) 100%)'
              : score >= 40
                ? 'linear-gradient(90deg, hsl(var(--wr-amber)) 0%, hsl(var(--wr-pink)) 100%)'
                : score >= 10
                  ? 'linear-gradient(90deg, hsl(var(--wr-cyan)) 0%, hsl(var(--wr-amber)) 100%)'
                  : 'linear-gradient(90deg, hsl(var(--wr-green)) 0%, hsl(var(--wr-cyan)) 100%)',
            boxShadow: `0 0 8px ${getColor()}`
          }}
        />
      </div>
    </div>
  );
};

// Wallet Type Badge
const WalletTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const config = {
    'GNOSIS_SAFE': { icon: Lock, label: 'GNOSIS SAFE', color: 'text-[hsl(var(--wr-purple))]' },
    'MULTISIG': { icon: Lock, label: 'MULTISIG', color: 'text-[hsl(var(--wr-purple))]/80' },
    'EOA': { icon: Unlock, label: 'EOA', color: 'text-[hsl(var(--wr-muted))]' },
    'UNKNOWN': { icon: Activity, label: 'UNKNOWN', color: 'text-[hsl(var(--wr-muted))]' },
  };

  const cfg = config[type as keyof typeof config] || config.UNKNOWN;
  const Icon = cfg.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-[9px] ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      <span className="hidden xl:inline">{cfg.label}</span>
    </span>
  );
};

// Expanded Row Details
const TokenDetails: React.FC<{ data: InsiderRiskData }> = ({ data }) => {
  const [activeTab, setActiveTab] = useState<'holders' | 'transfers'>('holders');

  return (
    <div className="bg-[hsl(var(--wr-bg3))]/50 border-t border-[hsl(var(--wr-border))]/40 p-4 animate-slide-in-expand">
      <div className="flex gap-4 mb-4 border-b border-[hsl(var(--wr-border))]/40 pb-2">
        <button 
          onClick={() => setActiveTab('holders')}
          className={`text-[10px] font-medium tracking-wider pb-2 border-b-2 transition-colors ${
            activeTab === 'holders' 
              ? 'border-[hsl(var(--wr-green))] text-[hsl(var(--wr-green))]' 
              : 'border-transparent text-[hsl(var(--wr-muted))] hover:text-[hsl(var(--wr-white))]'
          }`}
        >
          TOP HOLDERS ({data.holders?.length || 0})
        </button>
        <button 
          onClick={() => setActiveTab('transfers')}
          className={`text-[10px] font-medium tracking-wider pb-2 border-b-2 transition-colors ${
            activeTab === 'transfers' 
              ? 'border-[hsl(var(--wr-green))] text-[hsl(var(--wr-green))]' 
              : 'border-transparent text-[hsl(var(--wr-muted))] hover:text-[hsl(var(--wr-white))]'
          }`}
        >
          LARGE TRANSFERS ({data.largeTransfers?.length || 0})
        </button>
      </div>

      {activeTab === 'holders' && (
        <div className="space-y-2">
          {data.holders && data.holders.length > 0 ? (
            data.holders.map((holder, idx) => (
              <div key={holder.address} className="flex items-center justify-between text-[10px] py-1 border-b border-[hsl(var(--wr-border))]/20">
                <div className="flex items-center gap-2">
                  <span className="text-[hsl(var(--wr-muted))] w-4">{idx + 1}</span>
                  <span className="font-mono text-[hsl(var(--wr-cyan))]">
                    {holder.address.slice(0, 8)}...{holder.address.slice(-6)}
                  </span>
                  {holder.address.toLowerCase() === data.deployerAddress?.toLowerCase() && (
                    <Badge variant="outline" className="text-[8px] border-[hsl(var(--wr-pink))]/40 text-[hsl(var(--wr-pink))]">
                      DEPLOYER
                    </Badge>
                  )}
                  {holder.isContract && (
                    <Badge variant="outline" className="text-[8px] border-[hsl(var(--wr-purple))]/40 text-[hsl(var(--wr-purple))]">
                      CONTRACT
                    </Badge>
                  )}
                  {holder.tags?.map(tag => (
                    <Badge key={tag} variant="outline" className="text-[8px] border-[hsl(var(--wr-cyan))]/40 text-[hsl(var(--wr-cyan))]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[hsl(var(--wr-white))] font-mono">
                    {formatTokenAmount(holder.balance)}
                  </span>
                  <span className={`font-bold ${
                    holder.percentage > 20 ? 'text-[hsl(var(--wr-pink))]' : 
                    holder.percentage > 10 ? 'text-[hsl(var(--wr-amber))]' : 
                    'text-[hsl(var(--wr-green))]'
                  }`}>
                    {holder.percentage.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-[10px] text-[hsl(var(--wr-muted))]">No holder data available</p>
          )}

          {/* Concentration warning */}
          {data.top10Concentration > 80 && (
            <div className="mt-3 p-2 rounded bg-[hsl(var(--wr-pink))]/10 border border-[hsl(var(--wr-pink))]/30">
              <div className="flex items-center gap-2 text-[hsl(var(--wr-pink))]">
                <AlertTriangle className="w-3 h-3" />
                <span className="text-[9px] font-medium">
                  Extreme Concentration: {data.top10Concentration.toFixed(1)}% controlled by top 10 wallets
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'transfers' && (
        <div className="space-y-2">
          {data.prePumpTransfer?.detected && (
            <div className="p-3 rounded bg-[hsl(var(--wr-pink))]/10 border border-[hsl(var(--wr-pink))]/30 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-[hsl(var(--wr-pink))] animate-pulse" />
                <span className="text-[10px] font-bold text-[hsl(var(--wr-pink))]">
                  🔥 PRE-PUMP TRANSFER DETECTED
                </span>
              </div>
              <div className="text-[9px] text-[hsl(var(--wr-white))] space-y-1">
                <p>
                  <span className="text-[hsl(var(--wr-muted))]">Amount:</span>{' '}
                  <span className="font-mono font-bold">{formatTokenAmount(data.prePumpTransfer.amount)}</span> tokens
                </p>
                <p>
                  <span className="text-[hsl(var(--wr-muted))]">To:</span>{' '}
                  <span className="text-[hsl(var(--wr-cyan))]">{data.prePumpTransfer.toExchange}</span> deposit address
                </p>
                <p>
                  <span className="text-[hsl(var(--wr-muted))]">Timing:</span>{' '}
                  <span className="text-[hsl(var(--wr-amber))]">{data.prePumpTransfer.hoursBeforePump} hours</span> before price pump
                </p>
                <p className="text-[8px] text-[hsl(var(--wr-muted))]">
                  {new Date(data.prePumpTransfer.timestamp * 1000).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {data.largeTransfers && data.largeTransfers.length > 0 ? (
            data.largeTransfers.slice(0, 10).map((transfer, idx) => (
              <div key={idx} className="flex items-center justify-between text-[10px] py-1 border-b border-[hsl(var(--wr-border))]/20">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className={`w-3 h-3 ${transfer.isToCEX ? 'text-[hsl(var(--wr-pink))]' : 'text-[hsl(var(--wr-cyan))]'}`} />
                  <span className="font-mono text-[hsl(var(--wr-muted))]">
                    {transfer.txHash?.slice(0, 10)}...
                  </span>
                  {transfer.isToCEX && (
                    <Badge className="text-[8px] bg-[hsl(var(--wr-pink))]/20 text-[hsl(var(--wr-pink))] border-[hsl(var(--wr-pink))]/40">
                      → {transfer.cexName}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[hsl(var(--wr-white))] font-mono">
                    {formatTokenAmount(transfer.value)}
                  </span>
                  <span className="text-[hsl(var(--wr-muted))] text-[9px]">
                    {new Date(transfer.timestamp * 1000).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-[10px] text-[hsl(var(--wr-muted))]">No large transfers detected in last 72h</p>
          )}
        </div>
      )}
    </div>
  );
};

// Main Component
export const WRInsiderRiskScanner: React.FC<WRInsiderRiskScannerProps> = ({
  coins,
  isScanning,
  etherscanKey,
  birdeyeKey,
  onRefresh,
  lastScanTime
}) => {
  const [riskData, setRiskData] = useState<InsiderRiskData[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: keyof InsiderRiskData; direction: 'asc' | 'desc' }>(
    { key: 'riskScore', direction: 'desc' }
  );
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'completed' | 'error'>('idle');
  // Premium keys unlock deeper transfer/CEX analysis; free public APIs
  // (RugCheck / Ethplorer / DexScreener) always provide real data.
  const hasPremiumKeys = !!(etherscanKey || birdeyeKey);

  // Main scan function — never fabricates rows
  const runScan = useCallback(async () => {
    if (coins.length === 0 || scanStatus === 'scanning') return;

    setScanStatus('scanning');
    setScanProgress({ current: 0, total: coins.length });

    const results: InsiderRiskData[] = [];
    let errorCount = 0;

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      setScanProgress({ current: i + 1, total: coins.length });

      try {
        const riskInfo = await analyzeTokenRisk(coin, { etherscanKey, birdeyeKey });
        // Prefer score from public path when already computed; otherwise
        // derive via the shared calculator (premium Birdeye/Etherscan path).
        const scored = (typeof riskInfo.riskScore === 'number' && riskInfo.riskLevel)
          ? {
              score: riskInfo.riskScore,
              level: riskInfo.riskLevel,
              flags: riskInfo.flags || calculateRiskScore(riskInfo).flags,
            }
          : calculateRiskScore(riskInfo);

        const sol = coin.platforms?.solana;
        const eth = coin.platforms?.ethereum;
        const inferredChain: 'ethereum' | 'solana' =
          riskInfo.chain ||
          (sol ? 'solana' : 'ethereum');

        results.push({
          id: coin.id || `token-${i}`,
          symbol: coin.symbol || 'UNKNOWN',
          name: coin.name || 'Unknown Token',
          chain: inferredChain,
          address: riskInfo.address || sol || eth || (coin as unknown as { contract_address?: string }).contract_address || '',
          totalSupply: riskInfo.totalSupply || (coin as unknown as { total_supply?: number }).total_supply || 0,
          circulatingSupply: riskInfo.circulatingSupply || (coin as unknown as { circulating_supply?: number }).circulating_supply || 0,
          circulatingPercentage: riskInfo.circulatingPercentage || 0,
          holders: riskInfo.holders || [],
          top10Concentration: riskInfo.top10Concentration || 0,
          deployerAddress: riskInfo.deployerAddress || '',
          deployerBalance: riskInfo.deployerBalance || 0,
          deployerWalletType: riskInfo.deployerWalletType || 'UNKNOWN',
          topHolderAddress: riskInfo.topHolderAddress,
          largeTransfers: riskInfo.largeTransfers || [],
          cexTransfers24h: riskInfo.cexTransfers24h || 0,
          cexTransfers72h: riskInfo.cexTransfers72h || 0,
          prePumpTransfer: riskInfo.prePumpTransfer || null,
          riskScore: scored.score,
          riskLevel: scored.level,
          externalRiskScore: riskInfo.externalRiskScore ?? null,
          internalRiskScore: riskInfo.internalRiskScore ?? scored.score,
          riskModelVersion: riskInfo.riskModelVersion,
          riskProvider: riskInfo.riskProvider,
          flags: scored.flags,
          lastUpdated: Date.now(),
          scanStatus: 'completed',
          dataSource: 'real',
          fieldStatus: riskInfo.fieldStatus,
        });
      } catch (error) {
        // Honest "couldn't scan this" row — never substitute fabricated
        // numbers. riskLevel: 'UNKNOWN' renders distinctly (see RiskBadge).
        console.error(`Real-data scan failed for ${coin.symbol}:`, error);
        errorCount++;
        const sol = coin.platforms?.solana;
        const eth = coin.platforms?.ethereum;
        results.push({
          id: coin.id || `token-${i}`,
          symbol: coin.symbol || 'UNKNOWN',
          name: coin.name || 'Unknown Token',
          chain: sol ? 'solana' : 'ethereum',
          address: sol || eth || (coin as unknown as { contract_address?: string }).contract_address || '',
          totalSupply: (coin as unknown as { total_supply?: number }).total_supply || 0,
          circulatingSupply: (coin as unknown as { circulating_supply?: number }).circulating_supply || 0,
          circulatingPercentage: 0,
          holders: [],
          top10Concentration: 0,
          deployerAddress: '',
          deployerBalance: 0,
          deployerWalletType: 'UNKNOWN',
          largeTransfers: [],
          cexTransfers24h: 0,
          cexTransfers72h: 0,
          prePumpTransfer: null,
          riskScore: 0,
          riskLevel: 'UNKNOWN',
          flags: {
            lowCirculating: false,
            extremeTeamControl: false,
            highConcentration: false,
            prePumpCEX: false,
            gnosisSafe: false,
            largeCEXTransfers: false,
          },
          lastUpdated: Date.now(),
          scanStatus: 'error',
          errorMessage: error instanceof Error ? error.message : 'Scan failed',
          dataSource: 'real',
        });
      }

      // Small delay to prevent UI freezing
      await new Promise(r => setTimeout(r, 50));
    }

    setRiskData(results);
    setScanStatus(errorCount > results.length / 2 ? 'error' : 'completed');
    onRefresh();
  }, [coins, etherscanKey, birdeyeKey, onRefresh, scanStatus]);

  // Auto-scan when coins change
  useEffect(() => {
    if (coins.length > 0 && riskData.length === 0) {
      runScan();
    }
  }, [coins, riskData.length, runScan]);

  // Sort and filter
  const processedData = useMemo(() => {
    let data = [...riskData];

    if (filterLevel !== 'ALL') {
      data = data.filter(d => d.riskLevel === filterLevel);
    }

    data.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      return 0;
    });

    return data;
  }, [riskData, sortConfig, filterLevel]);

  const toggleRow = (id: string) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedRows(newSet);
  };

  const handleSort = (key: keyof InsiderRiskData) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const criticalCount = riskData.filter(d => d.riskLevel === 'CRITICAL').length;
  const highCount = riskData.filter(d => d.riskLevel === 'HIGH').length;

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--wr-bg1))] text-[hsl(var(--wr-white))]">
      {/* Header Stats Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))]">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[hsl(var(--wr-pink))]" />
            <span className="text-[10px] text-[hsl(var(--wr-muted))] tracking-wider">INSIDER RISK SCANNER</span>
            <span className="text-[10px] text-[hsl(var(--wr-pink))] font-mono">v10.0</span>
            {!hasPremiumKeys && (
              <Badge variant="outline" className="text-[8px] border-[hsl(var(--wr-cyan))]/40 text-[hsl(var(--wr-cyan))]">
                PUBLIC APIs
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--wr-pink))] animate-pulse" />
              <span className="text-[10px] font-medium">{criticalCount} CRITICAL</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--wr-amber))]" />
              <span className="text-[10px]">{highCount} HIGH</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Data Source Indicator */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-1 px-2 py-1 rounded border text-[9px] border-[hsl(var(--wr-green))]/40 text-[hsl(var(--wr-green))] bg-[hsl(var(--wr-green))]/10">
                  <Database className="w-3 h-3" />
                  {hasPremiumKeys ? 'LIVE + PREMIUM' : 'LIVE (PUBLIC)'}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-[10px]">
                  {hasPremiumKeys
                    ? 'Etherscan/Birdeye keys active — full transfer & CEX analysis'
                    : 'Keyless public APIs: RugCheck (Solana), Ethplorer (ETH), DexScreener. Add keys in Settings for deeper CEX/transfer analysis.'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="text-[10px] border-[hsl(var(--wr-border))] bg-transparent hover:bg-[hsl(var(--wr-bg3))]">
                Filter: {filterLevel} <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[hsl(var(--wr-bg2))] border-[hsl(var(--wr-border))]">
              {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(level => (
                <DropdownMenuItem 
                  key={level}
                  onClick={() => setFilterLevel(level)}
                  className="text-[10px] text-[hsl(var(--wr-white))] hover:bg-[hsl(var(--wr-bg3))] cursor-pointer"
                >
                  {level}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Refresh Button */}
          <Button 
            onClick={runScan}
            disabled={scanStatus === 'scanning'}
            size="sm"
            className="text-[10px] bg-[hsl(var(--wr-green))]/10 text-[hsl(var(--wr-green))] border border-[hsl(var(--wr-green))]/40 hover:bg-[hsl(var(--wr-green))]/20"
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${scanStatus === 'scanning' ? 'animate-spin' : ''}`} />
            {scanStatus === 'scanning' ? 'SCANNING...' : 'REFRESH'}
          </Button>

          {/* Export Button */}
          <Button 
            onClick={() => exportInsiderRiskCSV(processedData)}
            size="sm"
            variant="outline"
            className="text-[10px] border-[hsl(var(--wr-border))] bg-transparent hover:bg-[hsl(var(--wr-bg3))]"
          >
            <Download className="w-3 h-3 mr-1" />
            EXPORT
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      {scanStatus === 'scanning' && (
        <WRInsiderProgress 
          current={scanProgress.current}
          total={scanProgress.total}
          status={scanStatus}
        />
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-[hsl(var(--wr-bg2))] border-b border-[hsl(var(--wr-border))] z-10">
            <tr>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider w-8"></th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider cursor-pointer hover:text-[hsl(var(--wr-white))] transition-colors" onClick={() => handleSort('symbol')}>
                TOKEN {sortConfig.key === 'symbol' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider cursor-pointer hover:text-[hsl(var(--wr-white))] transition-colors" onClick={() => handleSort('riskScore')}>
                RISK {sortConfig.key === 'riskScore' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider hidden md:table-cell">
                FLAGS
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider hidden lg:table-cell cursor-pointer hover:text-[hsl(var(--wr-white))] transition-colors" onClick={() => handleSort('circulatingPercentage')}>
                CIRCULATING {sortConfig.key === 'circulatingPercentage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider hidden lg:table-cell cursor-pointer hover:text-[hsl(var(--wr-white))] transition-colors" onClick={() => handleSort('top10Concentration')}>
                TOP 10 {sortConfig.key === 'top10Concentration' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider hidden xl:table-cell">
                WALLET TYPE
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider hidden xl:table-cell">
                CEX TRANSFERS
              </th>
              <th className="text-left py-2 px-3 text-[9px] font-medium text-[hsl(var(--wr-muted))] tracking-wider">
                PRE-PUMP
              </th>
            </tr>
          </thead>
          <tbody className="text-[10px]">
            {scanStatus === 'scanning' && riskData.length === 0 ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[hsl(var(--wr-border))]/40">
                  <td className="py-3 px-3"><div className="w-4 h-4 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3"><div className="h-2.5 w-20 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3"><div className="h-2.5 w-16 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3 hidden md:table-cell"><div className="h-2.5 w-32 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3 hidden lg:table-cell"><div className="h-2.5 w-12 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3 hidden lg:table-cell"><div className="h-2.5 w-12 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3 hidden xl:table-cell"><div className="h-2.5 w-20 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3 hidden xl:table-cell"><div className="h-2.5 w-16 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                  <td className="py-3 px-3"><div className="h-2.5 w-12 rounded bg-[hsl(var(--wr-border))]/60 animate-pulse" /></td>
                </tr>
              ))
            ) : processedData.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-[hsl(var(--wr-muted))]">
                  <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No tokens match current filters</p>
                  <p className="text-[9px] mt-1">Run a scan to analyze insider risk data</p>
                </td>
              </tr>
            ) : (
              processedData.map((data) => (
                <React.Fragment key={data.id}>
                  <tr 
                    className={`border-b border-[hsl(var(--wr-border))]/40 hover:bg-[hsl(var(--wr-bg3))]/30 transition-colors cursor-pointer ${
                      data.riskLevel === 'CRITICAL' ? 'bg-[hsl(var(--wr-pink))]/5' : ''
                    }`}
                    onClick={() => toggleRow(data.id)}
                  >
                    <td className="py-2 px-3">
                      {expandedRows.has(data.id) ? 
                        <ChevronUp className="w-4 h-4 text-[hsl(var(--wr-muted))]" /> : 
                        <ChevronDown className="w-4 h-4 text-[hsl(var(--wr-muted))]" />
                      }
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-1 h-8 rounded-full ${
                          data.chain === 'ethereum' ? 'bg-[hsl(var(--wr-cyan))]' : 'bg-[hsl(var(--wr-purple))]'
                        }`} />
                        <div>
                          <div className="font-bold text-[hsl(var(--wr-white))]">{data.symbol}</div>
                          <div className="text-[8px] text-[hsl(var(--wr-muted))] font-mono truncate max-w-[100px]">
                            {data.address ? `${data.address.slice(0, 6)}...${data.address.slice(-4)}` : 'N/A'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex flex-col gap-1">
                        <RiskBadge level={data.riskLevel} score={data.riskScore} />
                        <RiskMeter score={data.riskScore} />
                      </div>
                    </td>
                    <td className="py-2 px-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(data.flags).map(([key, active]) => (
                          active && (
                            <FlagBadge 
                              key={key} 
                              type={key} 
                              active={active}
                              details={getFlagDetails(key, data)}
                            />
                          )
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 hidden lg:table-cell">
                      {data.fieldStatus?.circulating === 'UNAVAILABLE' || data.fieldStatus?.circulating === 'ERROR' ? (
                        <div className="font-mono text-[hsl(var(--wr-muted))]" title="Circulating supply not measured by this data provider">
                          n/a
                        </div>
                      ) : (
                        <>
                          <div className={`font-mono font-bold ${
                            data.circulatingPercentage < 30 ? 'text-[hsl(var(--wr-pink))]' :
                            data.circulatingPercentage < 50 ? 'text-[hsl(var(--wr-amber))]' :
                            'text-[hsl(var(--wr-green))]'
                          }`}>
                            {data.circulatingPercentage.toFixed(1)}%
                          </div>
                          {data.circulatingPercentage < 30 && (
                            <div className="text-[8px] text-[hsl(var(--wr-pink))]">Low Float</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 px-3 hidden lg:table-cell">
                      <div className={`font-mono font-bold ${
                        data.top10Concentration > 90 ? 'text-[hsl(var(--wr-pink))]' : 
                        data.top10Concentration > 80 ? 'text-[hsl(var(--wr-amber))]' : 
                        'text-[hsl(var(--wr-green))]'
                      }`}>
                        {data.top10Concentration.toFixed(1)}%
                      </div>
                      <div className="w-16 h-1 bg-[hsl(var(--wr-bg3))] rounded-full mt-1 overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            data.top10Concentration > 90 ? 'bg-[hsl(var(--wr-pink))]' : 
                            data.top10Concentration > 80 ? 'bg-[hsl(var(--wr-amber))]' : 
                            'bg-[hsl(var(--wr-green))]'
                          }`}
                          style={{ width: `${Math.min(100, data.top10Concentration)}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 hidden xl:table-cell">
                      <WalletTypeBadge type={data.deployerWalletType} />
                    </td>
                    <td className="py-2 px-3 hidden xl:table-cell">
                      {data.fieldStatus?.transfers === 'UNAVAILABLE' || data.fieldStatus?.transfers === 'ERROR' ? (
                        <span className="text-[hsl(var(--wr-muted))]" title="Transfer / CEX analysis requires premium API keys">n/a</span>
                      ) : data.cexTransfers24h > 0 ? (
                        <div className="flex items-center gap-1 text-[hsl(var(--wr-pink))]">
                          <Building2 className="w-3 h-3" />
                          <span className="font-bold">{data.cexTransfers24h}</span>
                          <span className="text-[8px]">(24h)</span>
                        </div>
                      ) : data.cexTransfers72h > 0 ? (
                        <div className="flex items-center gap-1 text-[hsl(var(--wr-amber))]">
                          <Building2 className="w-3 h-3" />
                          <span>{data.cexTransfers72h}</span>
                          <span className="text-[8px]">(72h)</span>
                        </div>
                      ) : (
                        <span className="text-[hsl(var(--wr-muted))]">0</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {data.prePumpTransfer ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <div className="flex items-center gap-1 text-[hsl(var(--wr-pink))] animate-pulse">
                                <TrendingUp className="w-3 h-3" />
                                <span className="text-[8px] font-bold">YES</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="bg-[hsl(var(--wr-bg2))] border-[hsl(var(--wr-pink))]/40">
                              <div className="text-[10px] space-y-1">
                                <p className="text-[hsl(var(--wr-pink))] font-bold">🔥 PRE-PUMP DETECTED</p>
                                <p>{formatTokenAmount(data.prePumpTransfer.amount)} tokens → {data.prePumpTransfer.toExchange}</p>
                                <p>{data.prePumpTransfer.hoursBeforePump}h before price surge</p>
                                <p className="text-[8px] text-[hsl(var(--wr-muted))]">
                                  {new Date(data.prePumpTransfer.timestamp * 1000).toLocaleString()}
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-[hsl(var(--wr-muted))]">-</span>
                      )}
                    </td>
                  </tr>
                  {expandedRows.has(data.id) && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <TokenDetails data={data} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="border-t border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] px-4 py-2 flex items-center justify-between text-[9px] text-[hsl(var(--wr-muted))]">
        <div className="flex items-center gap-4">
          <span>Analyzed: {riskData.length} tokens</span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">
            Data source: {hasPremiumKeys ? 'Live + premium APIs' : 'Live public APIs (RugCheck / Ethplorer / DexScreener)'}
          </span>
          <span className="hidden sm:inline">|</span>
          <span className="hidden sm:inline">Last updated: {new Date(lastScanTime).toLocaleTimeString()}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--wr-cyan))]" />
            Ethereum
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--wr-purple))]" />
            Solana
          </span>
        </div>
      </div>
    </div>
  );
};

// Helper function for flag details
function getFlagDetails(flagType: string, data: InsiderRiskData): string {
  switch (flagType) {
    case 'lowCirculating':
      return `Only ${data.circulatingPercentage.toFixed(1)}% of supply is circulating. High manipulation risk.`;
    case 'extremeTeamControl':
      return `${data.top10Concentration.toFixed(1)}% held by top 10 wallets. Extreme centralization.`;
    case 'highConcentration':
      return `Top 10 holders control ${data.top10Concentration.toFixed(1)}% of supply.`;
    case 'prePumpCEX':
      return data.prePumpTransfer 
        ? `${formatTokenAmount(data.prePumpTransfer.amount)} tokens moved to ${data.prePumpTransfer.toExchange} ${data.prePumpTransfer.hoursBeforePump}h before pump`
        : 'Suspicious pre-pump transfer pattern detected';
    case 'gnosisSafe':
      return 'Team wallet is Gnosis Safe multisig - often used for coordinated sells';
    case 'largeCEXTransfers':
      return `${data.cexTransfers24h} large transfers to CEX addresses in last 24h`;
    default:
      return '';
  }
}

export default WRInsiderRiskScanner;
