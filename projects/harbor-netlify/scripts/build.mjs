import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { prepareMigration } from './prepare-migration.mjs';
await prepareMigration();
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
// An empty private application entry lets Netlify identify a deployable site.
// The custom Function path owns '/' and all application page responses.
await writeFile('dist/index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Harbor</title></head><body><a href="/login">Sign in to Harbor</a></body></html>');
console.log('Harbor browser assets prepared; server pages are provided by the protected Function.');
