# Crypto Whale Watch Nexus

A comprehensive platform for tracking and analyzing cryptocurrency whale activity and blockchain transactions.

**Live Demo:** [https://crypto-whale-watch-nexus.vercel.app](https://crypto-whale-watch-nexus.vercel.app)

## 📋 Overview

Crypto Whale Watch Nexus is a full-stack application designed to monitor and analyze large cryptocurrency transactions ("whale" movements) across blockchain networks. It provides real-time insights into whale activity, insider risk assessments, and trading signals.

## 🏗️ Architecture

This is a **monorepo** containing both frontend and backend applications:

- **Frontend**: React + TypeScript SPA built with Vite
- **Backend**: Express.js REST API with PostgreSQL database
- **Deployment**: Vercel (frontend) + Node.js compatible hosting (backend)

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18.3 with TypeScript
- **Build Tool**: Vite 5.4
- **UI Components**: shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS 3.4
- **State Management**: TanStack React Query 5.83 (data fetching)
- **Forms**: React Hook Form 7.61 + Zod validation
- **Charts**: Recharts 2.15
- **Routing**: React Router DOM 6.30
- **Themes**: next-themes with dark mode support
- **Utilities**: date-fns, clsx, tailwind-merge
- **PWA**: Workbox for offline support

### Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js 4.19
- **Database**: PostgreSQL 8.12 (pg driver)
- **CORS**: Express CORS middleware
- **Development**: ts-node-dev with live reload

### External Services
- **Database**: Supabase (@supabase/supabase-js 2.49)
- **DEX Data**: Hyperliquid integration
- **Blockchain Data**: Insider Risk API

## 📂 Project Structure

```
crypto-whale-watch-nexus/
├── src/                              # Frontend source
│   ├── components/                   # Reusable React components
│   ├── pages/                        # Page components (Index, NotFound)
│   ├── hooks/                        # Custom React hooks
│   ├── lib/                          # Utility functions
│   ├── types/                        # TypeScript type definitions
│   ├── test/                         # Test files
│   ├── assets/                       # Static assets
│   ├── App.tsx                       # Main app component
│   ├── main.tsx                      # React entry point
│   ├── index.css                     # Global styles
│   ├── insiderRiskApi.ts             # Insider risk data API integration
│   ├── insider_risk_css.css          # Insider risk specific styles
│   └── vite-env.d.ts                 # Vite environment types
├── server/                           # Backend source
│   ├── index.ts                      # Express app & routes setup
│   ├── db.ts                         # Database connection & utilities
│   ├── package.json                  # Backend dependencies
│   ├── tsconfig.json                 # TypeScript config
│   ├── schema.sql                    # Database schema
│   ├── migrations/                   # Database migrations
│   ├── routes/                       # Express route handlers
│   └── services/                     # Business logic services
├── public/                           # Static files
├── supabase/                         # Supabase configuration
├── package.json                      # Frontend dependencies
├── vite.config.ts                    # Vite configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
├── index.html                        # HTML entry point
├── sw.js                             # Service worker
├── vercel.json                       # Vercel deployment config
├── Procfile                          # Heroku deployment config
├── DEPLOY.md                         # Deployment instructions
└── HYPERLIQUID_DEPLOY.md             # Hyperliquid integration guide
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ or Bun runtime
- npm/yarn/pnpm/bun package manager
- PostgreSQL 12+ (for backend)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/gepappas98/crypto-whale-watch-nexus.git
cd crypto-whale-watch-nexus
```

2. **Install frontend dependencies**
```bash
npm install
# or with bun
bun install
```

3. **Install backend dependencies**
```bash
cd server
npm install
cd ..
```

4. **Set up environment variables**
Create a `.env` file in the root with:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
DATABASE_URL=postgresql://user:password@localhost:5432/whale_watch
```

### Development

**Start frontend development server:**
```bash
npm run dev
```
Runs on http://localhost:5173

**Start backend development server:**
```bash
npm run dev:api
```
Runs on http://localhost:3001

**Start both simultaneously:**
```bash
npm run dev:all
```

**Database setup:**
```bash
npm run db:migrate
```

## 📊 Key Features

- ✅ **Real-time Whale Tracking** - Monitor large cryptocurrency transactions
- ✅ **Insider Risk Assessment** - Analyze insider activity patterns
- ✅ **Hyperliquid Integration** - Track perpetual futures market movements
- ✅ **Signal Outcomes** - Historical trade signal performance tracking
- ✅ **Charts & Analytics** - Visual analysis of whale activity trends
- ✅ **Dark Mode Support** - Theme customization with next-themes
- ✅ **Responsive Design** - Works on desktop and mobile devices
- ✅ **PWA Support** - Offline capabilities with service worker
- ✅ **Advanced Filtering** - Filter by chain, volume, threat level
- ✅ **Portfolio Tracking** - Monitor personal holdings

## 🔌 API Endpoints

Backend provides REST endpoints including:
- `GET /api/scan` - Fetch latest coin market data
- `POST /api/signal-outcomes/fill-prices` - Fill historical price data
- `GET/POST /api/whale-events` - Whale transaction tracking
- Database-backed routes for analytics and tracking

See `server/routes/` and `server/services/` for implementation details.

## 🧪 Testing

**Run tests:**
```bash
npm run test
```

**Watch mode:**
```bash
npm run test:watch
```

**E2E testing with Playwright:**
```bash
npx playwright test
```

## 📝 Scripts

### Frontend Scripts
- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run build:dev` - Development build
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run test` - Run unit tests
- `npm run test:watch` - Watch mode for tests

### Backend Scripts (in `server/`)
- `npm run dev` - Start dev server with auto-reload
- `npm run build` - Compile TypeScript
- `npm run start` - Run compiled application

### Combined Scripts
- `npm run dev:all` - Start frontend + backend concurrently
- `npm run dev:api` - Start backend API
- `npm run db:migrate` - Run database migrations
- `npm run fill-prices` - Fill historical price data

## 📦 Build & Deployment

### Vercel (Frontend)
```bash
npm run build
# Connect GitHub repo to Vercel for automatic deployments
```

See [DEPLOY.md](./DEPLOY.md) for detailed deployment instructions.

### Hyperliquid Integration
See [HYPERLIQUID_DEPLOY.md](./HYPERLIQUID_DEPLOY.md) for Hyperliquid setup.

## 📈 Main Components

### Frontend
- **Index.tsx** - Main dashboard (~69KB, core application logic)
- **WRRightPanel.tsx** - Right sidebar with alerts & whale feed
- **App.tsx** - Root app with routing & React Query setup
- **shadcn/ui** - Reusable button, card, dialog, table components

### Backend
- **db.ts** - Database connection pooling & utilities
- **index.ts** - Express app setup, middleware, route handlers
- **schema.sql** - PostgreSQL database schema

### Integration Modules
- **useHyperliquid.ts** - React hook for Hyperliquid API
- **hyperliquid.ts** - Hyperliquid API client
- **insiderRiskApi.ts** - Insider risk data fetching (~12KB)

## 🔐 Security

- Uses Supabase for authentication
- Environment-based configuration for sensitive keys
- CORS-protected API endpoints
- Type-safe database queries with pg driver
- Input validation with Zod schemas

## 🎨 Styling

- Tailwind CSS utility-first styling
- Dark mode support with next-themes
- Custom CSS for insider risk components
- shadcn/ui design system integration
- Responsive breakpoints for mobile/tablet/desktop

## 📱 Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile responsive design
- PWA capabilities for offline use
- Service worker for caching

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run linting: `npm run lint`
4. Run tests: `npm run test`
5. Submit a pull request

## 📄 License

[License to be specified]

## 📞 Support & Documentation

- **Deployment Guide**: [DEPLOY.md](./DEPLOY.md)
- **Hyperliquid Integration**: [HYPERLIQUID_DEPLOY.md](./HYPERLIQUID_DEPLOY.md)
- **Live App**: [https://crypto-whale-watch-nexus.vercel.app](https://crypto-whale-watch-nexus.vercel.app)
- **Issues**: [GitHub Issues](https://github.com/gepappas98/crypto-whale-watch-nexus/issues)

## 📊 Repository Information

- **Language**: TypeScript
- **Repository Size**: ~845 KB
- **Status**: Active Development
- **Last Updated**: April 2026
- **Created**: April 2026

---

**Built with ❤️ for cryptocurrency market analysis**
