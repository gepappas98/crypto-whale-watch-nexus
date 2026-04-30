import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NexusPro from "./pages/NexusPro.tsx";
import NotFound from "./pages/NotFound.tsx";
import { useBotWebSocket } from '@/hooks/useBotWebSocket'
import { StatusBar } from '@/components/StatusBar'

function App() {
  useBotWebSocket() // Connects WS on app load

  return (
    <>
      {/* Your existing Nexus routes + new ones */}
      <Routes>
        <Route path="/" element={<WhaleDashboard />} />
        <Route path="/arbitrage" element={<ArbitrageCommandCenter />} />
        <Route path="/grid" element={<GridStudio />} />
        <Route path="/volume" element={<VolumeController />} />
        <Route path="/portfolio" element={<Portfolio />} />
      </Routes>
      <StatusBar />
    </>
  )
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/pro" element={<NexusPro />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
