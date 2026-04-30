import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
// Existing: Whale Watch tab
// NEW: Add these routes
import { ArbitrageCommandCenter } from '@/pages/Arbitrage'
import { GridStudio } from '@/pages/Grid' 
import { VolumeController } from '@/pages/Volume'
import { Portfolio } from '@/pages/Portfolio'

const routes = [
  { path: '/', label: 'Whale Watch', component: WhaleDashboard }, // existing
  { path: '/arbitrage', label: 'Arbitrage', component: ArbitrageCommandCenter },
  { path: '/grid', label: 'Grid', component: GridStudio },
  { path: '/volume', label: 'Volume', component: VolumeController },
  { path: '/portfolio', label: 'Portfolio', component: Portfolio },
]
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
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
