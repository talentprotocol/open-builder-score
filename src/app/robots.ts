import type { MetadataRoute } from 'next'

// Prerendered at build time into a plain /robots.txt, like every other page
// here — this must not become a function the CDN has to call.
export const dynamic = 'force-static'

// Crawlers that fetch the whole site on a loop and send no one to it.
//
// This site is static and 100% CDN-cached, so each crawl is cheap
// individually, but it is also nearly all of the traffic: the pages a person
// would never seek out (/terms, /privacy) are crawled about as often as the
// landing page, which is the shape of a machine walking the sitemap rather
// than of an audience. On Vercel's Hobby plan those fetches are metered as
// Edge Requests against a 1M/month allowance, and this project alone accounts
// for roughly four fifths of the account's total.
//
// Two kinds are listed. Backlink and SEO-audit indexes (Ahrefs, Semrush,
// Majestic, Moz, DataForSEO, BLEX) exist to sell competitive-intelligence
// reports about the site to other people; nothing they do returns a visitor.
// Bulk AI scrapers (Meta's two, ByteDance's) collect training corpora, which
// is not the same thing as the AI *search* crawlers below that cite and link
// back. All of them honour robots.txt.
//
// Deliberately still allowed, and the reason to disallow by name rather than
// default-deny: Googlebot, Bingbot and DuckDuckBot, which people actually
// arrive through; facebookexternalhit, Twitterbot, Slackbot and friends,
// which fetch a page once to build the link preview when someone shares it —
// blocking those breaks every shared score link; and OAI-SearchBot and
// PerplexityBot, which answer questions with a citation back here.
const BULK_CRAWLERS = [
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DotBot',
  'BLEXBot',
  'DataForSeoBot',
  'PetalBot',
  'meta-externalagent',
  'meta-webindexer',
  'Bytespider',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: BULK_CRAWLERS, disallow: '/' },
    ],
  }
}
