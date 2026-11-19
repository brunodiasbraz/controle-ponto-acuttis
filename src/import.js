import { readFile } from 'node:fs/promises';
import { importMarks, one, pool } from './db.js';

const file = process.argv[2];
const username = process.env.IMPORT_USERNAME;
if (!file || !username) { console.error('Uso: IMPORT_USERNAME=usuario npm run import -- arquivo.json'); process.exit(1); }
try {
  const user = await one('SELECT id FROM users WHERE username = ?', [username]);
  if (!user) throw new Error('Usuário não encontrado.');
  console.log(await importMarks(JSON.parse(await readFile(file, 'utf8')), user.id));
} finally {
  await pool.end();
}
