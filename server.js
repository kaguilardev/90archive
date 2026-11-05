import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./public', import.meta.url));
const indexFile = fileURLToPath(new URL('./public/index.html', import.meta.url));
const products = JSON.parse(readFileSync(new URL('./data/products.json', import.meta.url), 'utf8'));

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/api/products', (_req, res) => res.json(products));

app.use(express.static(publicDir, { index: false }));

// Pages are drawn in the browser, so each real page URL returns the same HTML shell.
app.get(/^\/(shop(\/[a-z0-9-]+)?|cart)?\/?$/, (_req, res) => res.sendFile(indexFile));
app.use((_req, res) => res.status(404).sendFile(indexFile));

// Render provides PORT and requires listening on 0.0.0.0.
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`90archive running on port ${port}`));
