import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">404</h1>
        <p className="text-slate-400 mb-4">Page not found</p>
        <Link to="/" className="text-purple-400 hover:text-purple-300">
          Go home
        </Link>
      </div>
    </div>
  );
}
