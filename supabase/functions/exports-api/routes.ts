/**
 * exports-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'exports-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.13
  //   GET    /exports/:entity.csv                     — stream CSV
  //   GET    /exports/:entity.xlsx                    — stream XLSX
  //   POST   /exports/jobs                            — queue large export, async
  //   GET    /exports/jobs/:id                        — poll job status
  //   POST   /exports/imports/:entity                 — multipart CSV upload; dry-run report
  //   GET    /exports/imports/:id                     — read import status / dry-run report
  //   POST   /exports/imports/:id/commit              — commit a dry-run import
  //   DELETE /exports/imports/:id                     — discard import
];
