/**
 * Finance-domain query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md
 * "Query keys", shape is `[module, entity, ...args]`. Construct keys via
 * these objects — never inline in components.
 *
 * Wave 3 / Phase 3 sales chassis: currencies, exchange rates, taxes,
 * payment methods.
 */

export const currencyKeys = {
  all: ['finance', 'currencies'] as const,
  list: () => [...currencyKeys.all, 'list'] as const,
  detail: (code: string) => [...currencyKeys.all, 'detail', code] as const,
};

export const exchangeRateKeys = {
  all: ['finance', 'exchange-rates'] as const,
  list: () => [...exchangeRateKeys.all, 'list'] as const,
  detail: (id: string) => [...exchangeRateKeys.all, 'detail', id] as const,
};

export const taxKeys = {
  all: ['finance', 'taxes'] as const,
  list: () => [...taxKeys.all, 'list'] as const,
  detail: (id: string) => [...taxKeys.all, 'detail', id] as const,
};

export const paymentMethodKeys = {
  all: ['finance', 'payment-methods'] as const,
  list: () => [...paymentMethodKeys.all, 'list'] as const,
  detail: (id: string) => [...paymentMethodKeys.all, 'detail', id] as const,
};
