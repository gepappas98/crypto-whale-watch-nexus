import { useEffect, useState } from "react";
import { getBot, isBotConnected, type TradingBot } from "@/lib/nexus/bot";

export function useNexusBot(): { bot: TradingBot | null; connected: boolean } {
  const [connected, setConnected] = useState(isBotConnected());
  useEffect(() => {
    const onReg = () => setConnected(true);
    const onUnreg = () => setConnected(false);
    window.addEventListener("nexus:bot:registered", onReg);
    window.addEventListener("nexus:bot:unregistered", onUnreg);
    return () => {
      window.removeEventListener("nexus:bot:registered", onReg);
      window.removeEventListener("nexus:bot:unregistered", onUnreg);
    };
  }, []);
  return { bot: getBot(), connected };
}
