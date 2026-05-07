import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Orderflow from "./pages/Orderflow.tsx";
import NexusLayout from "./components/nexus/NexusLayout";
import NexusWhaleWatch from "./pages/nexus/NexusWhaleWatch";
import NexusArbitrage from "./pages/nexus/NexusArbitrage";
import NexusGridStudio from "./pages/nexus/NexusGridStudio";
import NexusVolumeMaker from "./pages/nexus/NexusVolumeMaker";
import NexusPortfolio from "./pages/nexus/NexusPortfolio";
import NexusCrystalBall from "./pages/nexus/NexusCrystalBall";
import { Navigate } from "react-router-dom";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Global defaults — per-hook overrides take precedence.
      // Keeps the HL 300ms polls from thrashing on window focus.
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
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/orderflow" element={<Orderflow />} />
          <Route path="/nexus" element={<NexusLayout />}>
            <Route index element={<Navigate to="/nexus/whale" replace />} />
            <Route path="whale" element={<NexusWhaleWatch />} />
            <Route path="arbitrage" element={<NexusArbitrage />} />
            <Route path="grid" element={<NexusGridStudio />} />
            <Route path="volume" element={<NexusVolumeMaker />} />
            <Route path="portfolio" element={<NexusPortfolio />} />
            <Route path="crystal-ball" element={<NexusCrystalBall />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
