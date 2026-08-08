import type { ExchangeAdapter } from './types';
import { binanceAdapter } from './binance';
import { bybitAdapter } from './bybit';
import { okxAdapter } from './okx';
import { krakenAdapter } from './kraken';

export const EXCHANGE_ADAPTERS: Record<string, ExchangeAdapter> = {
  binance: binanceAdapter,
  bybit: bybitAdapter,
  okx: okxAdapter,
  kraken: krakenAdapter,
};

export function getAdapter(id: string): ExchangeAdapter | undefined {
  return EXCHANGE_ADAPTERS[id];
}

export const NEW_EXCHANGE_IDS = ['okx', 'kraken'] as const;
