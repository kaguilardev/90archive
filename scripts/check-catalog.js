// Runs as the build step, so a broken catalog fails the deploy instead of the live site.
import { readFileSync } from 'node:fs';

const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));
const errors = [];
const slugs = new Set();

for (const p of products) {
  const label = p.slug || JSON.stringify(p);
  if (!/^[a-z0-9-]+$/.test(p.slug || '')) errors.push(`${label}: invalid slug`);
  if (slugs.has(p.slug)) errors.push(`${label}: duplicate slug`);
  slugs.add(p.slug);
  if (!p.team) errors.push(`${label}: missing team`);
  if (!(p.priceUsd > 0)) errors.push(`${label}: price must be above 0`);
  if (!(p.discountUsd >= 0) || p.discountUsd >= p.priceUsd) errors.push(`${label}: bad discount`);
  if (!p.notes?.en || !p.notes?.es || p.notes.en.length !== p.notes.es.length) {
    errors.push(`${label}: notes must exist in both languages`);
  }
  if (!Array.isArray(p.images)) errors.push(`${label}: images must be a list`);
  const h = p.history;
  if (!p.title || !h?.years) errors.push(`${label}: missing title or years`);
  for (const part of [h?.headline, h?.story, h?.moment?.date, h?.moment?.title, h?.moment?.text, h?.photo?.caption, h?.photo?.alt]) {
    if (!part?.en?.length || !part?.es?.length) errors.push(`${label}: chapter text must exist in both languages`);
  }
  if (!h?.photo?.credit || !h?.photo?.license || !h?.photo?.page) errors.push(`${label}: photo needs credit, license and source`);
  for (const [size, qty] of Object.entries(p.stock || {})) {
    if (!Number.isInteger(qty) || qty < 0) errors.push(`${label}: bad stock for ${size}`);
  }
}

if (errors.length) {
  console.error(`Catalog has ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

const units = products.reduce((sum, p) => sum + Object.values(p.stock).reduce((a, b) => a + b, 0), 0);
console.log(`Catalog OK: ${products.length} models, ${units} units.`);
