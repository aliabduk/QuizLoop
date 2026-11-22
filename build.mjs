import { cp, mkdir, writeFile } from 'node:fs/promises';

const url = new URL(process.env.SUPABASE_URL || 'about:blank');
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('Set SUPABASE_URL to the HTTPS origin of your Supabase project.');
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY to the project publishable key beginning with sb_publishable_.');
}
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
await writeFile('dist/config.js', 'window.RECALL_CONFIG = ' + JSON.stringify({url: url.origin, key}) + ';\n');
