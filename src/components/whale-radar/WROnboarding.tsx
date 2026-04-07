/* ══ WHALE RADAR v9 — ONBOARDING WIZARD ══════════════════════════════════════ */
import { useState } from 'react';

interface WROnboardingProps {
  onFinish: () => void;
}

const STEPS = [
  {
    title: 'WELCOME TO WHALE RADAR v9',
    icon: '🐳',
    content: `The most advanced market manipulation detection system for crypto traders.
    
Whale Radar scans 250+ tokens in real-time, detecting wash trading, pump & dump schemes, whale accumulation, and rug pull risks — all powered by AI and on-chain analytics.`,
  },
  {
    title: 'QUICK START',
    icon: '⚡',
    content: `1. Click SCAN (or press S) to start your first scan
2. Watch the scanner table for CRITICAL and HIGH threat tokens
3. Click + to track any token's price in real-time
4. Check the 🚨 ALERTS panel for manipulation warnings

Pro tip: Press A to enable AUTO mode for continuous monitoring.`,
  },
  {
    title: 'POWER FEATURES',
    icon: '✦',
    content: `• AI Analysis — Add your Anthropic key in ⚙ for per-token AI insights
• Solana On-Chain — Add Birdeye key to detect rug pulls and LP unlocks
• Wallet Tracking — Add Helius key to monitor whale wallet flows
• Backtesting — Test alert accuracy against historical data
• Portfolio — Track your holdings against manipulation risk

All API keys use free tiers. Enter them in ⚙ Settings.`,
  },
  {
    title: 'KEYBOARD SHORTCUTS',
    icon: '⌨',
    content: `S — Scan now
A — Toggle AUTO mode
W — Watchlist filter
B — Backtesting module
P — Portfolio manager
H — Scan history
? — Show all shortcuts
ESC — Close modals

You're ready. Happy hunting! 🎯`,
  },
];

export function WROnboarding({ onFinish }: WROnboardingProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  return (
    <div className="fixed inset-0 bg-black/90 z-[500] flex items-center justify-center animate-modal-fade">
      <div className="bg-wr-bg2 border border-wr-border border-t-2 border-t-wr-green max-w-lg w-[96%] animate-modal-up">
        {/* Header */}
        <div className="px-5 py-3 border-b border-wr-border bg-wr-bg3 flex items-center justify-between">
          <span className="font-head text-[10px] tracking-[3px] text-wr-green">
            {current.icon} {current.title}
          </span>
          <button className="text-wr-muted hover:text-wr-red text-lg cursor-pointer bg-transparent border-none font-mono" onClick={onFinish}>✕</button>
        </div>

        {/* Body */}
        <div className="p-6">
          <div className="onboarding-step">
            <p className="text-[10px] text-wr-white leading-[1.8] whitespace-pre-line">{current.content}</p>
          </div>

          {/* Progress dots */}
          <div className="onboarding-dots mt-6">
            {STEPS.map((_, i) => (
              <div key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
            ))}
          </div>

          {/* Nav buttons */}
          <div className="flex justify-between mt-6">
            <button
              className="wr-btn"
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
              style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
            >
              ← BACK
            </button>
            {step < STEPS.length - 1 ? (
              <button className="wr-btn active" onClick={() => setStep(s => s + 1)}>
                NEXT →
              </button>
            ) : (
              <button className="wr-btn active" onClick={onFinish} style={{ boxShadow: '0 0 12px hsl(var(--wr-green) / .3)' }}>
                🎯 START SCANNING
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
