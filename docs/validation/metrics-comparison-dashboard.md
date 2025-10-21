| Metric | Baseline (Pre-Transform) | Current | Delta % | Target | Status | Notes |
| - | - | - | - | - | - | - |
| TypeScript errors | Unknown | 117 | N/A | 0 | ❌ | Strict compilation failed with 114 unused declarations, 2 missing imports, 1 missing return. |
| TypeScript warnings | Unknown | 0 | N/A | 0 | ⚠️ | Compiler stopped on errors before warnings could be evaluated. |
| ESLint errors | Unknown | 0 | N/A | 0 | ✅ | No rule violations reported. |
| ESLint warnings | Unknown | 11 | N/A | 0 | ❌ | All warnings from `prettier/prettier`; run formatting to resolve. |
| Circular dependencies | Unknown | 0 | N/A | 0 | ✅ | Madge reported no cycles (55 files processed, 6 warnings). |
| Unused dependencies | Unknown | 6 prod / 5 dev | N/A | 0 | ❌ | Depcheck flagged unused prod deps (`@aws-sdk/*`, `ioredis`, `node-tesseract-ocr`, `socket.io`, `tsconfig-paths`) and dev deps (`@nestjs/schematics`, `@types/jest`, `nodemon`, `source-map-support`, `husky`). |
| Missing dependencies | Unknown | 3 | N/A | 0 | ❌ | `uuid`, `k6`, `express-validator` referenced in code but absent from package.json. |
| CRITICAL vulnerabilities | Unknown | 0 | N/A | 0 | ✅ | npm audit reported none at critical severity. |
| HIGH vulnerabilities | Unknown | 2 | N/A | 0 | ❌ | High severity advisories for `multer` and `@nestjs/platform-express` remain. |
| Build time (s) | Unknown | Build failed (~0.90s before error) | N/A | < Baseline / Successful build | ❌ | `npm run build` blocked by missing `upload.controller` and `upload.service` modules; no artifact produced. |
| Bundle size (MB) | Unknown | N/A | N/A | < Baseline | ⚠️ | Build failure prevented measurement. |
| Lines of code | Unknown | 7,014 | N/A | Informational | ⚠️ | LOC counted across `src/**/*.{ts,js}` for density calculations. |
| Cyclomatic complexity avg | Unknown | Not measured | N/A | ≤ Baseline | ⚠️ | Tooling not available in this run; requires dedicated analyzer. |
