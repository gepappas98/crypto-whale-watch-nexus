import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-4">
      <h1 className="text-6xl font-bold mb-4">404</h1>
      <p className="text-xl text-slate-400 mb-8">Page Not Found</p>
      <Link
        to="/"
        className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 rounded-lg font-semibold transition-colors"
      >
        ← Back to Whale Radar
      </Link>
    </div>
  );
}
