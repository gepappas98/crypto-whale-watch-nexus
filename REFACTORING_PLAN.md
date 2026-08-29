# Refactoring Plan: ESLint Compliance & Architecture Improvements

## Executive Summary
- **93 ESLint findings** to resolve (errors then warnings)
- **4 massive files** (Index.tsx 53KB, WRCrystalBallPro.tsx 59KB, NexusCrystalBallV5.tsx 59KB, trading-bridge/index.ts 38KB)
- **High coupling & regression risk** from monolithic components
- **Duplicate Crystal Ball implementations** (redundancy, maintenance cost)
- **No shared Edge/client type schemas** (payload validation gaps)

---

## Phase 1: ESLint Configuration & Error Baseline (Priority: CRITICAL)

### Step 1.1: Upgrade ESLint Rules (enable strict defaults)
```bash
# Current eslint.config.js is loose — enable TypeScript strict checks:
```

**Current State:**
```javascript
rules: {
  "@typescript-eslint/no-unused-vars": "off",  // ← Too permissive
  // Missing: no-explicit-any, no-var, empty blocks, etc.
}
```

**Action:** Update `eslint.config.js` to enforce:

```javascript
export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-var-requires": "error",
      "no-var": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
    },
  },
);
```

### Step 1.2: Run Linter & Categorize Findings
```bash
npm run lint > lint-report.txt 2>&1
# Categorize into:
#   - ERRORS (must fix now): no-explicit-any, no-var, require(), type mismatches
#   - WARNINGS (phase out): unused vars, floating promises, empty blocks
```

### Step 1.3: Create `.eslintignore` Allowlist (temporary)
```
# Do NOT ignore — we want to catch everything
# But DO create a fixture file for future CI gates
# eslintignore-initial.json
{
  "ignoredCounts": {
    "no-explicit-any": 15,
    "no-var": 8,
    "empty": 3,
    "require": 5
  },
  "rules": "Once baseline is below threshold (target: 0 errors, 10 warnings), enforce strict CI"
}
```

---

## Phase 2: Fix Critical ESLint Errors (Priority: HIGH)

### Step 2.1: Replace `any` with Proper Types

**Pattern 1: Component Props**
```typescript
// ❌ BEFORE
interface WRModalProps {
  content: any;
  onClose: () => void;
}

// ✅ AFTER
interface WRModalProps {
  content: React.ReactNode | JSX.Element;
  onClose: () => void;
}
```

**Pattern 2: API Responses**
```typescript
// ❌ BEFORE
async function fetchData() {
  const res: any = await api.get('/data');
  return res.data;
}

// ✅ AFTER
interface ApiResponse<T> {
  data: T;
  error?: string;
  status: number;
}

async function fetchData<T>(): Promise<T> {
  const res = await api.get<ApiResponse<T>>('/data');
  return res.data.data;
}
```

**Pattern 3: State & Callbacks**
```typescript
// ❌ BEFORE
const [data, setData] = useState<any>(null);

// ✅ AFTER
interface DataShape { /* ... */ }
const [data, setData] = useState<DataShape | null>(null);
```

### Step 2.2: Replace `require()` with `import`

```typescript
// ❌ BEFORE
const config = require('./config.json');

// ✅ AFTER
import config from './config.json';
```

### Step 2.3: Replace `var` with `const/let`

```bash
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's/^  var /  const /g'
```

### Step 2.4: Add Default Cases to Switches & Empty Block Handling

```typescript
// ❌ BEFORE
switch (level) {
  case 'critical': doX();
  case 'high': doY();
  // Missing default
}

// ✅ AFTER
switch (level) {
  case 'critical': return doX();
  case 'high': return doY();
  default: return null;
}
```

---

## Phase 3: Component Architecture Refactoring (Priority: HIGH)

### Step 3.1: Decompose `Index.tsx` (53 KB)

**Current Problem:** All state, effects, WebSocket handling, UI rendering in one file.

**Target Structure:**
```
src/pages/
  Index.tsx (200 lines, container only)
  ├── hooks/
  │   ├── useIndexState.ts (app-wide state declarations)
  │   ├── useIndexEffects.ts (init, persistence, effects)
  │   └── useIndexHandlers.ts (callbacks, event handlers)
  ├── containers/
  │   ├── MainDashboard.tsx (grid layout)
  │   ├── WhaleFeedContainer.tsx (whale stream orchestration)
  │   └── RegimeContainer.tsx (regime engine container)
  └── services/
      └── indexStateManager.ts (centralized state logic)
```

**Step 3.1a: Extract State into Custom Hook**
```typescript
// src/pages/hooks/useIndexState.ts
export function useIndexState() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [whaleFeed, setWhaleFeed] = useState<WhaleTrade[]>([]);
  const [tracked, setTracked] = useState<Record<string, TrackedToken>>({});
  // ... all 40+ state declarations
  
  return {
    alerts, setAlerts,
    whaleFeed, setWhaleFeed,
    tracked, setTracked,
    // ...
  };
}
```

**Step 3.1b: Extract Effects into Separate Hook**
```typescript
// src/pages/hooks/useIndexEffects.ts
export function useIndexEffects(state: ReturnType<typeof useIndexState>) {
  useEffect(() => {
    // Persistence logic (currently lines 134-162)
  }, []);
  
  useEffect(() => {
    // Performance monitoring (currently lines 165-168)
  }, []);
  
  // ... refactor each major effect group into its own hook or function
}
```

**Step 3.1c: Refactor Index.tsx to Container Pattern**
```typescript
// src/pages/Index.tsx (SIMPLIFIED)
export default function WhaleRadarApp() {
  const state = useIndexState();
  useIndexEffects(state);
  
  return (
    <div className="min-h-screen flex flex-col">
      <WRHeader {...state} />
      <WRTicker coins={state.coins.slice(0, 30)} />
      <MainDashboard state={state} />
      <WRStatsBar {...state} />
    </div>
  );
}
```

### Step 3.2: Decompose `WRCrystalBallPro.tsx` (59 KB)

**Current Problem:** Likely contains UI rendering, data fetching, and logic all together.

**Target Structure:**
```
src/components/whale-radar/crystal-ball/
  ├── WRCrystalBallPro.tsx (container, ~100 lines)
  ├── hooks/
  │   ├── useCrystalBallData.ts (fetch, cache, predictions)
  │   └── useCrystalBallState.ts (local UI state)
  ├── containers/
  │   ├── PredictionPanel.tsx (chart, metrics display)
  │   └── SignalConsole.tsx (logging, debug output)
  └── services/
      ├── predictionEngine.ts (pure logic, testable)
      └── signals.ts (signal scoring)
```

**Step 3.2a: Extract Data Hook**
```typescript
// src/components/whale-radar/crystal-ball/hooks/useCrystalBallData.ts
export function useCrystalBallData() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    const fetchPredictions = async () => {
      // All data fetching logic from WRCrystalBallPro.tsx
    };
    fetchPredictions();
  }, []);
  
  return { predictions, loading };
}
```

**Step 3.2b: Extract UI Components**
```typescript
// src/components/whale-radar/crystal-ball/containers/PredictionPanel.tsx
export function PredictionPanel({ predictions }: { predictions: Prediction[] }) {
  return (
    <div className="...">
      <Chart data={predictions} />
      <MetricsGrid metrics={summaizePredictions(predictions)} />
    </div>
  );
}
```

### Step 3.3: **CRITICAL: Merge `NexusCrystalBallV5.tsx` with WRCrystalBallPro**

**Problem:** Two implementations of the same feature.

**Action:**
1. Diff the two files
2. Keep the better implementation (likely V5 if newer)
3. Delete the obsolete one
4. Standardize on **one naming convention** (CrystalBall.tsx)
5. Document why V5 was chosen in commit message

```bash
# Command to diff:
diff src/components/whale-radar/WRCrystalBallPro.tsx \
     src/components/nexus/NexusCrystalBallV5.tsx | head -200
```

---

## Phase 4: Shared Type Schemas (Priority: MEDIUM)

### Step 4.1: Create Central Types for Edge ↔ Client Communication

**Problem:** Edge functions and client code likely have duplicated or mismatched type definitions.

**Target Structure:**
```
src/lib/schemas/
  ├── edge.ts (types for server→client payloads)
  ├── client.ts (types for client requests)
  ├── validation.ts (Zod schemas for runtime validation)
  └── index.ts (re-exports for convenience)
```

**Step 4.1a: Define Shared Schemas with Zod**
```typescript
// src/lib/schemas/validation.ts
import { z } from 'zod';

export const WhaleTxPayloadSchema = z.object({
  ts: z.number(),
  sym: z.string(),
  side: z.enum(['BUY', 'SELL']),
  price: z.number().positive(),
  qty: z.number().positive(),
  usdt: z.number().positive(),
  exchange: z.enum(['binance', 'okx', 'kraken', 'bybit']),
  confidence: z.number().min(0).max(1),
});

export type WhaleTxPayload = z.infer<typeof WhaleTxPayloadSchema>;

// Server-side validation
export async function validateWhaleEvent(payload: unknown): Promise<WhaleTxPayload> {
  return WhaleTxPayloadSchema.parseAsync(payload);
}
```

**Step 4.1b: Update Edge Functions to Use Schemas**
```typescript
// server/functions/whale-stream.ts
import { WhaleTxPayloadSchema, type WhaleTxPayload } from '@/lib/schemas/validation';

export async function handleWhaleStream(req: Request) {
  const body = await req.json();
  const validated = await WhaleTxPayloadSchema.parseAsync(body);
  // ✅ Now type-safe
}
```

**Step 4.1c: Update Client Code to Use Schemas**
```typescript
// src/hooks/useWhaleStream.ts
import { WhaleTxPayloadSchema, type WhaleTxPayload } from '@/lib/schemas/validation';

export function useWhaleStream() {
  const handleMessage = useCallback((msg: WebSocket.MessageEvent) => {
    const data = JSON.parse(msg.data);
    const validated = WhaleTxPayloadSchema.safeParse(data);
    if (!validated.success) {
      console.error('Invalid whale payload:', validated.error);
      return;
    }
    // ✅ Type-narrowed to WhaleTxPayload
  }, []);
}
```

---

## Phase 5: `trading-bridge/index.ts` Refactoring (Priority: MEDIUM)

### Step 5.1: Audit & Decompose (38 KB file)

**Action:**
```bash
wc -l src/server/trading-bridge/index.ts  # Check line count
head -50 src/server/trading-bridge/index.ts  # See structure
```

**Likely Issues:**
- Multiple concerns: validation, execution, error handling, all in one file
- Missing separation between adapter logic and bridge orchestration

**Target Structure:**
```
src/server/trading-bridge/
  ├── index.ts (orchestrator, ~100 lines)
  ├── executors/
  │   ├── binanceExecutor.ts (Binance-specific logic)
  │   ├── hyperliquidExecutor.ts (Hyperliquid-specific logic)
  │   └── base.ts (shared executor interface)
  ├── validators/
  │   ├── orderValidator.ts (Zod schemas)
  │   └── riskValidator.ts (position checks, exposure limits)
  └── services/
      ├── orderManager.ts (state machine)
      └── riskManager.ts (drawdown, correlation checks)
```

---

## Phase 6: Implementation Roadmap

| Phase | Task | Effort | ESLint Impact | PRs |
|-------|------|--------|---------------|-----|
| 1 | ESLint config + error baseline | 1d | Visibility | 1 |
| 2 | Fix critical errors (any, var, require) | 3d | 40 findings → 0 errors | 5 |
| 2 | Fix warnings (empty, floating promises) | 2d | 50 warnings → 5 warnings | 3 |
| 3 | Decompose Index.tsx | 3d | Maintainability | 2 |
| 3 | Decompose WRCrystalBallPro.tsx | 2d | + 15KB savings | 1 |
| 3 | Merge duplicates (V5 + Pro) | 1d | + 59KB savings | 1 |
| 4 | Create shared schemas | 2d | Type safety | 2 |
| 5 | Refactor trading-bridge | 2d | + 12KB savings | 2 |
| **TOTAL** | | **16d** | **90 findings → 5 warnings** | **~17 PRs** |

---

## Acceptance Criteria

✅ **Phase 1-2 Complete:**
- `npm run lint` returns 0 errors
- max 10 warnings (all non-critical)
- ESLint config in strict mode

✅ **Phase 3 Complete:**
- Index.tsx < 300 lines
- WRCrystalBallPro.tsx < 200 lines
- Only one Crystal Ball implementation
- Each file has single responsibility

✅ **Phase 4 Complete:**
- All Edge ↔ Client payloads validated with Zod
- No duplicate type definitions
- `src/lib/schemas/` is source of truth

✅ **Phase 5 Complete:**
- trading-bridge/ split into executors + validators
- Each executor < 200 lines
- Shared risk validation

---

## Quick Start Commands

```bash
# 1. See current state
npm run lint

# 2. Fix auto-fixables
npx eslint . --fix

# 3. Upgrade config
# Edit eslint.config.js (see Phase 1.1 above)

# 4. Run again to see remaining
npm run lint

# 5. Start Phase 2 refactoring
# Follow error-by-error roadmap above
```

---

## Notes for Next Sprint

- **Do NOT** try to fix all 93 at once — do phases sequentially
- **Errors first** (breaking changes), warnings second (code hygiene)
- **Test as you go** — each PR should have vitest coverage for refactored code
- **Duplicate removal** is a **hard delete** — no soft deprecation (one version only)
- **Schemas are investment** — once written, entire codebase benefits
