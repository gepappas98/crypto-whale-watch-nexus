import CrystalBallPro from './components/CrystalBallPro'

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-purple-400 mb-2">Whale Radar</h1>
          <p className="text-slate-400 text-sm">AI-powered crypto forecasting with Kronos</p>
        </header>
        <CrystalBallPro />
      </main>
    </div>
  )
}

export default App
