/**
 * crm-api — route table.
 *
 * Wave 2: ships customers, contacts, leads, opportunities, activities.
 * See TS1/09-api/00-API-CONTRACT.md §3.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  patchCustomer,
  restoreCustomer,
} from './handlers/customers.ts';
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  patchContact,
} from './handlers/contacts.ts';
import {
  convertLead,
  createLead,
  getLead,
  listLeads,
  patchLead,
} from './handlers/leads.ts';
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  patchOpportunity,
  updateOpportunityStage,
} from './handlers/opportunities.ts';
import {
  createActivity,
  listActivities,
  patchActivity,
} from './handlers/activities.ts';

const BUNDLE = 'crm-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Customers
  { method: 'GET', path: '/customers', handler: listCustomers },
  { method: 'POST', path: '/customers', handler: createCustomer },
  { method: 'GET', path: '/customers/:id', handler: getCustomer },
  { method: 'PATCH', path: '/customers/:id', handler: patchCustomer },
  { method: 'POST', path: '/customers/:id/archive', handler: archiveCustomer },
  { method: 'POST', path: '/customers/:id/restore', handler: restoreCustomer },

  // Contacts
  { method: 'GET', path: '/contacts', handler: listContacts },
  { method: 'POST', path: '/contacts', handler: createContact },
  { method: 'GET', path: '/contacts/:id', handler: getContact },
  { method: 'PATCH', path: '/contacts/:id', handler: patchContact },
  { method: 'DELETE', path: '/contacts/:id', handler: deleteContact },

  // Leads
  { method: 'GET', path: '/leads', handler: listLeads },
  { method: 'POST', path: '/leads', handler: createLead },
  { method: 'GET', path: '/leads/:id', handler: getLead },
  { method: 'PATCH', path: '/leads/:id', handler: patchLead },
  { method: 'POST', path: '/leads/:id/convert', handler: convertLead },

  // Opportunities
  { method: 'GET', path: '/opportunities', handler: listOpportunities },
  { method: 'POST', path: '/opportunities', handler: createOpportunity },
  { method: 'GET', path: '/opportunities/:id', handler: getOpportunity },
  { method: 'PATCH', path: '/opportunities/:id', handler: patchOpportunity },
  { method: 'PUT', path: '/opportunities/:id/stage', handler: updateOpportunityStage },

  // Activities
  { method: 'GET', path: '/activities', handler: listActivities },
  { method: 'POST', path: '/activities', handler: createActivity },
  { method: 'PATCH', path: '/activities/:id', handler: patchActivity },
];
