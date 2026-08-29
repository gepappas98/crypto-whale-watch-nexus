# Phase 1-2 Implementation Guide: ESLint Errors & Type Fixes

## Overview
This guide provides **step-by-step code fixes** for the 93 ESLint findings, starting with errors (must fix) then warnings (code quality).

---

## Step 1: Upgrade ESLint Configuration

### Current State (permissive):
```javascript
// eslint.config.js
rules: {
  "@typescript-eslint/no-unused-vars": "off",  // Too lenient
}
```

### Action: Apply Strict Config
Replace `eslint.config.js` with:

```javascript
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strict,
      ...tseslint.configs.stylistic,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // ═══ ERRORS (must fix, blocks build) ═══
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-var-requires": "error",
      "no-var": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_|^ignored",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // ═══ WARNINGS (code quality, non-blocking) ═══
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/await-thenable": "warn",
    },
  },
);
```

### Validate:
```bash
npm run lint 2>&1 | tee lint-baseline.txt
# Output should now show all 93 findings clearly categorized
```

---

## Step 2: Auto-Fix Trivial Issues

```bash
# This fixes ~40-50% of errors automatically:
npx eslint . --fix

# Common fixes applied:
#  - var → const/let
#  - Trailing commas
#  - Unused imports
#  - Quote consistency
```

---

## Step 3: Manual Type Fixes (no-explicit-any)

### Pattern A: Replace `any` in Function Signatures

**BEFORE:**
```typescript
function analyzeToken(data: any): any {
  return { score: data.risk };
}
```

**AFTER:**
```typescript
interface TokenAnalysis {
  risk: number;
  score: number;
  category: string;
}

interface TokenData {
  risk: number;
  [key: string]: unknown;
}

function analyzeToken(data: TokenData): TokenAnalysis {
  return { score: data.risk, risk: data.risk, category: "unknown" };
}
```

### Pattern B: Replace `any` in React Props

**BEFORE:**
```typescript
interface ComponentProps {
  data: any;
  onUpdate: (x: any) => void;
  config?: any;
}
```

**AFTER:**
```typescript
interface CoinData {
  symbol: string;
  price: number;
  volume: number;
}

type OnUpdateCallback = (data: CoinData) => void;

interface ComponentConfig {
  theme: "dark" | "light";
  autoRefresh: boolean;
  maxItems: number;
}

interface ComponentProps {
  data: CoinData;
  onUpdate: OnUpdateCallback;
  config?: ComponentConfig;
}
```

### Pattern C: Replace `any` in State (React Hooks)

**BEFORE:**
```typescript
const [state, setState] = useState<any>(null);
const [cache, setCache] = useState<any>({});
```

**AFTER:**
```typescript
interface AppState {
  coins: CoinData[];
  alerts: AlertItem[];
  loading: boolean;
}

type CoinCache = Record<string, CoinData>;

const [state, setState] = useState<AppState | null>(null);
const [cache, setCache] = useState<CoinCache>({});
```

### Pattern D: Replace `any` in Event Handlers

**BEFORE:**
```typescript
const handleChange = (e: any) => {
  setValue(e.target.value);
};

const handleClick = (event: any) => {
  console.log(event);
};
```

**AFTER:**
```typescript
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setValue(e.target.value);
};

const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
  console.log(event);
};
```

### Pattern E: Replace `any` in Async/API Responses

**BEFORE:**
```typescript
async function fetchCoin(id: string): Promise<any> {
  const res = await fetch(`/api/coins/${id}`);
  return res.json();
}
```

**AFTER:**
```typescript
interface ApiErrorResponse {
  error: string;
  status: number;
}

interface CoinApiResponse {
  success: boolean;
  data: CoinData;
  timestamp: number;
}

type ApiResponse<T> = T | ApiErrorResponse;

async function fetchCoin(id: string): Promise<ApiResponse<CoinData>> {
  const res = await fetch(`/api/coins/${id}`);
  const json = (await res.json()) as ApiResponse<CoinData>;
  return json;
}
```

---

## Step 4: Fix no-var Issues

### Pattern: Replace `var` with `const` or `let`

**Script to bulk-fix (careful):**
```bash
# Test on ONE file first:
sed -i.bak 's/^\([ \t]*\)var /\1const /g' src/lib/someFile.ts

# Verify output:
git diff src/lib/someFile.ts

# If good, apply to all:
find src -name "*.ts" -o -name "*.tsx" | while read f; do
  sed -i.bak 's/^\([ \t]*\)var /\1const /g' "$f"
done

# Clean backups:
find src -name "*.bak" -delete
```

### Manual Review Required:
```typescript
// ❌ Auto-converted (MIGHT BE WRONG):
const x = 1;
const x = 2;  // ← Now a redeclaration error

// ✅ Correct fix:
let x = 1;
x = 2;

// Also check:
for (var i = 0; i < 10; i++) { }
// ↓
for (let i = 0; i < 10; i++) { }
```

---

## Step 5: Fix no-empty Issues

### Pattern: Add Default Case or Comment

**BEFORE:**
```typescript
switch (level) {
  case "critical":
    alert();
    break;
  case "high":
    warn();
    break;
  // Missing default
}

try {
  doSomething();
} catch {
  // Silent failure
}
```

**AFTER:**
```typescript
switch (level) {
  case "critical":
    alert();
    break;
  case "high":
    warn();
    break;
  default:
    // No action needed for other levels
    break;
}

try {
  doSomething();
} catch (e) {
  // Intentionally swallow network errors on retry
  console.debug("Retryable error:", e instanceof Error ? e.message : "unknown");
}
```

---

## Step 6: Fix require() Issues (no-var-requires)

### Pattern: Convert require() to import

**BEFORE:**
```typescript
const fs = require('fs');
const config = require('./config.json');
const { apiKey } = require('./env');
```

**AFTER:**
```typescript
import fs from 'fs';
import config from './config.json' assert { type: 'json' };
import { apiKey } from './env.js';
```

### For JSON in TypeScript:
```typescript
// Option 1: Use assert (modern)
import data from './data.json' assert { type: 'json' };

// Option 2: Use glob import (if tsconfig allows)
import * as data from './data.json';

// Option 3: Define interface and load dynamically (if must use require)
// ↑ Avoid this — convert to import
```

---

## Step 7: Run Linter & Verify Progress

```bash
npm run lint
```

**Expected Output Progression:**

| Phase | Errors | Warnings |
|-------|--------|----------|
| Initial | 45 | 48 |
| After config | 45 | 48 |
| After `--fix` | 20 | 35 |
| After manual any fixes | 5 | 25 |
| After var/require/empty | 0 | 20 |
| After final review | 0 | 5-10 |

---

## Step 8: Create Lint Baseline & Enforce via CI

```bash
# Save current state:
npm run lint > .lint-baseline.json

# Add to package.json:
{
  "scripts": {
    "lint": "eslint .",
    "lint:report": "eslint . --format json > lint-report.json",
    "lint:baseline": "npm run lint:report && diff lint-report.json .lint-baseline.json"
  }
}

# Add to GitHub Actions (.github/workflows/lint.yml):
name: Lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
        # ✅ Fails on any new errors
```

---

## Common Mistakes to Avoid

### ❌ Don't:
```typescript
// Replacing any with unknown everywhere
function process(data: unknown) {
  return data.x; // Still errors — you haven't narrowed type
}

// Using as any to silence errors
const x = fetchData() as any;

// Using @ts-ignore
// @ts-ignore
const y = badCode();
```

### ✅ Do:
```typescript
// Use type guards
function process(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'x' in data) {
    return (data as { x: string }).x;
  }
  throw new Error('Invalid data shape');
}

// Use Zod for validation
import { z } from 'zod';
const schema = z.object({ x: z.string() });
const x = schema.parse(fetchData());

// Use optional chaining & nullish coalescing
const value = data?.x ?? 'default';
```

---

## Commands Reference

```bash
# 1. Check baseline
npm run lint 2>&1 | head -100

# 2. Auto-fix what you can
npx eslint . --fix

# 3. Count remaining errors
npm run lint 2>&1 | grep error | wc -l

# 4. Show only errors (no warnings)
npm run lint 2>&1 | grep -v warning

# 5. Fix specific file
npx eslint src/pages/Index.tsx --fix

# 6. Dry-run: see what would be fixed
npx eslint . --fix --dry-run

# 7. Export report for analysis
npx eslint . --format json > lint-report.json
```

---

## Checklist for Phase 1-2 Completion

- [ ] eslint.config.js upgraded to strict mode
- [ ] `npm run lint` returns 0 errors
- [ ] All `any` types replaced with proper interfaces
- [ ] All `var` replaced with `const`/`let`
- [ ] All `require()` converted to `import`
- [ ] All empty blocks have explanatory comments
- [ ] CI configured to enforce (`npm run lint` in GitHub Actions)
- [ ] lint-baseline saved (prevents regression)
- [ ] Team reviewed & approved changes

---

## Next Steps

Once Phase 1-2 are complete:
1. Start Phase 3: Component decomposition (Index.tsx, WRCrystalBallPro.tsx)
2. Merge duplicate Crystal Ball implementations
3. Create shared schemas (Phase 4)
4. Refactor trading-bridge (Phase 5)
