import { readFile } from 'node:fs/promises';
import { db, importMarks } from './db.js';

const file = process.argv[2];
const username = process.env.IMPORT_USERNAME;
if (!file || !username) { console.error('Uso: IMPORT_USERNAME=usuario npm run import -- arquivo.json'); process.exit(1); }
const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user) throw new Error('Usuário não encontrado.');
console.log(importMarks(JSON.parse(await readFile(file, 'utf8')), user.id));
