import { sources } from './content.js';

const ORIGIN = 'https://errr.in';

export const robotsTxt = () => `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;

export async function sitemapXml() {
  const { writeups } = await sources();
  const urls = ['/', ...writeups.map((w) => `/writeups/${w.name}/`)];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc></url>\n`).join('')
    + '</urlset>\n';
}
