// jeep-sqlite (browser dev mode) needs sql-wasm.wasm served from /assets
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/sql.js/dist/sql-wasm.wasm';
if (existsSync(src)) { mkdirSync('public/assets', { recursive: true }); copyFileSync(src, 'public/assets/sql-wasm.wasm'); }
