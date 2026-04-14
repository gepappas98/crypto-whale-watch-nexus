// src/components/whale-radar/WRInsiderProgress.tsx

import React from 'react';
import { Loader2, Database, CheckCircle, AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface WRInsiderProgressProps {
  current: number;
  total: number;
  status: 'idle' | 'scanning' | 'completed' | 'error';
  currentToken?: string;
  errors?: number;
}

export const WRInsiderProgress: React.FC<WRInsiderProgressProps> = ({
  current,
  total,
  status,
  currentToken,
  errors = 0
}) => {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="bg-[hsl(var(--wr-bg2))] border border-[hsl(var(--wr-border))] rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {status === 'scanning' && (
            <Loader2 className="w-4 h-4 text-[hsl(var(--wr-cyan))] animate-spin" />
          )}
          {status === 'completed' && (
            <CheckCircle className="w-4 h-4 text-[hsl(var(--wr-green))]" />
          )}
          {status === 'error' && (
            <AlertCircle className="w-4 h-4 text-[hsl(var(--wr-red))]" />
          )}
          {status === 'idle' && (
            <Database className="w-4 h-4 text-[hsl(var(--wr-muted))]" />
          )}

          <span className="text-[11px] font-medium text-[hsl(var(--wr-white))]">
            {status === 'scanning' && 'Analyzing On-Chain Data...'}
            {status === 'completed' && 'Analysis Complete'}
            {status === 'error' && 'Analysis Failed'}
            {status === 'idle' && 'Ready to Scan'}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-[hsl(var(--wr-muted))]">
            {current} / {total} tokens
          </span>
          {errors > 0 && (
            <span className="text-[hsl(var(--wr-red))]">
              {errors} errors
            </span>
          )}
        </div>
      </div>

      <div className="relative">
        <Progress 
          value={percentage} 
          className="h-1.5 bg-[hsl(var(--wr-bg3))]"
        />
        <div 
          className="absolute top-0 left-0 h-1.5 rounded-full transition-all duration-300"
          style={{ 
            width: `${percentage}%`,
            background: status === 'error' 
              ? 'hsl(var(--wr-red))' 
              : `linear-gradient(90deg, hsl(var(--wr-green)) 0%, hsl(var(--wr-cyan)) 50%, hsl(var(--wr-green)) 100%)`
          }}
        />
      </div>

      {currentToken && status === 'scanning' && (
        <div className="mt-2 flex items-center gap-2 text-[9px] text-[hsl(var(--wr-muted))]">
          <span>Currently analyzing:</span>
          <span className="text-[hsl(var(--wr-cyan))] font-mono">{currentToken}</span>
        </div>
      )}

      {status === 'completed' && (
        <div className="mt-2 text-[9px] text-[hsl(var(--wr-green))]">
          ✓ Insider risk analysis updated with latest on-chain data
        </div>
      )}
    </div>
  );
};

export default WRInsiderProgress;
