/**
 * R-W1-06 — bundle-size CI gate.
 *
 * The Wave 1 closeout journal documented a measured 29.23 kB gzip for the
 * SPA index chunk. Budget of 80 kB leaves ~50 kB of headroom for Wave 2's
 * CRM surface (customers / contacts / activities pages + components).
 * Tighten the budget once the surface stabilizes.
 *
 * The check runs at `pnpm bundle-budget` after `pnpm build`. CI invokes
 * both. Locally, run `pnpm --filter web bundle-budget`.
 *
 * Why preset-app: per the size-limit docs, preset-app handles SPA bundles
 * (gzip + brotli + minified JS) without trying to build with webpack.
 */
module.exports = [
  {
    name: 'SPA index chunk',
    path: 'dist/assets/index-*.js',
    limit: '80 kB',
    gzip: true,
  },
];
