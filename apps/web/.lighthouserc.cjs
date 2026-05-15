/* Lighthouse CI config — Wave 0 budget floor. Tightened in Wave 8. */
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      numberOfRuns: 1,
      url: ['http://localhost/index.html'],
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['off', {}],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
