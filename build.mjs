import { cp, mkdir, writeFile } from 'node:fs/promises';

const url = new URL(process.env.SUPABASE_URL || 'about:blank');
const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error('Set SUPABASE_URL to the HTTPS origin of your Supabase project.');
}
if (!key) {
  throw new Error('Missing Supabase public key. Set SUPABASE_PUBLISHABLE_KEY in the Vercel environment used by this deployment.');
}
function isLegacyAnonKey(value) {
  const parts = value.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url')).role === 'anon';
  } catch {
    return false;
  }
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !isLegacyAnonKey(key)) {
  throw new Error('Invalid Supabase public key format. Copy the publishable key or legacy anon key from Project Settings > API Keys.');
}
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
await writeFile('dist/config.js', 'window.RECALL_CONFIG = ' + JSON.stringify({url: url.origin, key}) + ';\n');
