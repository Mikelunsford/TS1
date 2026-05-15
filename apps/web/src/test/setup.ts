import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest's `globals: true` exposes `expect`/`describe`/`it` already.
// This file augments expectations and ensures DOM cleanup between tests.

afterEach(() => {
  cleanup();
});
