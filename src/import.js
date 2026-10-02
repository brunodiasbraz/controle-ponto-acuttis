import { readFile } from 'node:fs/promises';
import { importMarks } from './db.js';

const file = process.argv[2];
if (!file) { console.error('Uso: npm run import -- arquivo.json'); process.exit(1); }
console.log(importMarks(JSON.parse(await readFile(file, 'utf8'))));
