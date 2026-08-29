// src/components/whale-radar/WRInsiderRiskSettings.tsx

import React, { useState, useEffect } from 'react';
import { 
  Shield, Key, Database, AlertCircle, CheckCircle, 
  ExternalLink, Save, TestTube, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  InsiderRiskSettings, 
  DEFAULT_CEX_ADDRESSES 
} from '@/types/insiderRisk';

interface WRInsiderRiskSettingsProps {
  settings: InsiderRiskSettings;
  onSave: (settings: InsiderRiskSettings) => void;
}

export const WRInsiderRiskSettings: React.FC<WRInsiderRiskSettingsProps> = ({
  settings,
  onSave
}) => {
  const [localSettings, setLocalSettings] = useState<InsiderRiskSettings>(settings);
  const [testStatus, setTestStatus] = useState<{
    etherscan: 'idle' | 'testing' | 'success' | 'error';
    birdeye: 'idle' | 'testing' | 'success' | 'error';
  }>({ etherscan: 'idle', birdeye: 'idle' });

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    onSave(localSettings);
  };

  const testEtherscan = async () => {
    if (!localSettings.etherscanApiKey) return;
    setTestStatus(prev => ({ ...prev, etherscan: 'testing' }));

    try {
      // Test API key with a simple ETH balance query
      const response = await fetch(
        `https://api.etherscan.io/api?module=account&action=balance&address=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb&tag=latest&apikey=${localSettings.etherscanApiKey}`
      );
      const data = await response.json();

      if (data.status === '1') {
        setTestStatus(prev => ({ ...prev, etherscan: 'success' }));
      } else {
        setTestStatus(prev => ({ ...prev, etherscan: 'error' }));
      }
    } catch (error) {
      setTestStatus(prev => ({ ...prev, etherscan: 'error' }));
    }
  };

  const testBirdeye = async () => {
    if (!localSettings.birdeyeApiKey) return;
    setTestStatus(prev => ({ ...prev, birdeye: 'testing' }));

    try {
      // Test Birdeye API with a simple token list query
      const response = await fetch(
        'https://public-api.birdeye.so/defi/tokenlist?offset=0&limit=1',
        {
          headers: {
            'X-API-KEY': localSettings.birdeyeApiKey,
            'x-chain': 'solana'
          }
        }
      );

      if (response.ok) {
        setTestStatus(prev => ({ ...prev, birdeye: 'success' }));
      } else {
        setTestStatus(prev => ({ ...prev, birdeye: 'error' }));
      }
    } catch (error) {
      setTestStatus(prev => ({ ...prev, birdeye: 'error' }));
    }
  };

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-4 border-b border-[hsl(var(--wr-border))]">
        <Shield className="w-5 h-5 text-[hsl(var(--wr-pink))]" />
        <div>
          <h3 className="text-sm font-bold text-[hsl(var(--wr-white))]">Insider Risk Scanner</h3>
          <p className="text-[10px] text-[hsl(var(--wr-muted))]">
            Configure on-chain analysis APIs
          </p>
        </div>
      </div>

      {/* Etherscan API */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[hsl(var(--wr-cyan))]" />
            <Label className="text-[11px] font-medium text-[hsl(var(--wr-white))]">
              Etherscan API Key
            </Label>
          </div>
          <a 
            href="https://etherscan.io/apis" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[9px] text-[hsl(var(--wr-cyan))] flex items-center gap-0.5 hover:underline"
          >
            Get Key <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="flex gap-2">
          <Input
            type="password"
            value={localSettings.etherscanApiKey}
            onChange={(e) => setLocalSettings(prev => ({ ...prev, etherscanApiKey: e.target.value }))}
            placeholder="Enter Etherscan API key..."
            className="flex-1 bg-[hsl(var(--wr-bg3))] border-[hsl(var(--wr-border))] text-[10px] text-[hsl(var(--wr-white))] placeholder:text-[hsl(var(--wr-muted))]"
          />
          <Button
            onClick={testEtherscan}
            disabled={!localSettings.etherscanApiKey || testStatus.etherscan === 'testing'}
            size="sm"
            variant="outline"
            className="text-[9px] border-[hsl(var(--wr-border))] bg-transparent"
          >
            {testStatus.etherscan === 'testing' ? (
              '...'
            ) : testStatus.etherscan === 'success' ? (
              <CheckCircle className="w-3 h-3 text-[hsl(var(--wr-green))]" />
            ) : testStatus.etherscan === 'error' ? (
              <AlertCircle className="w-3 h-3 text-[hsl(var(--wr-red))]" />
            ) : (
              <TestTube className="w-3 h-3" />
            )}
          </Button>
        </div>

        <p className="text-[9px] text-[hsl(var(--wr-muted))]">
          Required for Ethereum token holder analysis and transaction history
        </p>
      </div>

      {/* Birdeye API */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[hsl(var(--wr-purple))]" />
            <Label className="text-[11px] font-medium text-[hsl(var(--wr-white))]">
              Birdeye API Key
            </Label>
          </div>
          <a 
            href="https://birdeye.so/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[9px] text-[hsl(var(--wr-purple))] flex items-center gap-0.5 hover:underline"
          >
            Get Key <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="flex gap-2">
          <Input
            type="password"
            value={localSettings.birdeyeApiKey}
            onChange={(e) => setLocalSettings(prev => ({ ...prev, birdeyeApiKey: e.target.value }))}
            placeholder="Enter Birdeye API key..."
            className="flex-1 bg-[hsl(var(--wr-bg3))] border-[hsl(var(--wr-border))] text-[10px] text-[hsl(var(--wr-white))] placeholder:text-[hsl(var(--wr-muted))]"
          />
          <Button
            onClick={testBirdeye}
            disabled={!localSettings.birdeyeApiKey || testStatus.birdeye === 'testing'}
            size="sm"
            variant="outline"
            className="text-[9px] border-[hsl(var(--wr-border))] bg-transparent"
          >
            {testStatus.birdeye === 'testing' ? (
              '...'
            ) : testStatus.birdeye === 'success' ? (
              <CheckCircle className="w-3 h-3 text-[hsl(var(--wr-green))]" />
            ) : testStatus.birdeye === 'error' ? (
              <AlertCircle className="w-3 h-3 text-[hsl(var(--wr-red))]" />
            ) : (
              <TestTube className="w-3 h-3" />
            )}
          </Button>
        </div>

        <p className="text-[9px] text-[hsl(var(--wr-muted))]">
          Required for Solana token analysis and holder data
        </p>
      </div>

      {/* Auto-scan Settings */}
      <div className="space-y-3 pt-4 border-t border-[hsl(var(--wr-border))]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[hsl(var(--wr-amber))]" />
            <Label className="text-[11px] font-medium text-[hsl(var(--wr-white))]">
              Auto-scan on Main Scan
            </Label>
          </div>
          <Switch
            checked={localSettings.enableAutoScan}
            onCheckedChange={(checked) => setLocalSettings(prev => ({ ...prev, enableAutoScan: checked }))}
          />
        </div>

        <p className="text-[9px] text-[hsl(var(--wr-muted))]">
          Automatically run insider risk analysis when main Whale Radar scan completes
        </p>
      </div>

      {/* CEX Addresses Info */}
      <div className="p-3 rounded bg-[hsl(var(--wr-bg3))]/50 border border-[hsl(var(--wr-border))]">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-3 h-3 text-[hsl(var(--wr-muted))]" />
          <span className="text-[9px] font-medium text-[hsl(var(--wr-muted))]">
            Tracked CEX Addresses
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.keys(DEFAULT_CEX_ADDRESSES).map(cex => (
            <span 
              key={cex}
              className="text-[8px] px-1.5 py-0.5 rounded bg-[hsl(var(--wr-bg2))] text-[hsl(var(--wr-muted))] border border-[hsl(var(--wr-border))]"
            >
              {cex}
            </span>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <Button 
        onClick={handleSave}
        className="w-full bg-[hsl(var(--wr-green))]/10 text-[hsl(var(--wr-green))] border border-[hsl(var(--wr-green))]/40 hover:bg-[hsl(var(--wr-green))]/20"
      >
        <Save className="w-4 h-4 mr-2" />
        Save Settings
      </Button>

      {/* Info Alert */}
      <Alert className="bg-[hsl(var(--wr-amber))]/10 border-[hsl(var(--wr-amber))]/40 text-[hsl(var(--wr-amber))]">
        <Info className="w-3 h-3" />
        <AlertDescription className="text-[9px]">
          Keys are optional. Without them the scanner still uses real public APIs
          (RugCheck for Solana, Ethplorer for ETH, DexScreener for liquidity).
          Etherscan/Birdeye keys unlock deeper transfer and CEX analysis.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default WRInsiderRiskSettings;
