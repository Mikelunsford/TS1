-- 0037_settings_port.sql
-- Purpose: org_settings table + per-org seed values ported from Idurar
--   defaultSettings/*.json. Idempotent ON CONFLICT.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.org_settings CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.org_settings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  setting_group  text NOT NULL,
  setting_key    text NOT NULL,
  setting_value  jsonb NOT NULL DEFAULT 'null'::jsonb,
  value_type     text NOT NULL DEFAULT 'string' CHECK (value_type IN
                   ('string','number','boolean','array','object','image','color')),
  is_private     boolean NOT NULL DEFAULT false,
  is_core        boolean NOT NULL DEFAULT false,
  description    text NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL REFERENCES auth.users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, setting_key)
);
CREATE INDEX IF NOT EXISTS idx_org_settings_group ON public.org_settings (org_id, setting_group);
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- app group
INSERT INTO public.org_settings (org_id, setting_group, setting_key, setting_value, value_type, description)
SELECT o.id, 'app', s.key, s.value::jsonb, s.vt, s.descr
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('app_date_format',     '"YYYY-MM-DD"',   'string',  'Default date format'),
    ('app_language',        '"en_us"',        'string',  'Default UI language'),
    ('app_country',         'null',           'string',  'Default country'),
    ('app_timezone',        'null',           'string',  'Default timezone'),
    ('app_company_email',   'null',           'string',  'Primary company email'),
    ('app_has_multi_branch','false',          'boolean', 'Multi-branch toggle'),
    ('app_industry',        '"default"',      'string',  'Industry tag'),
    ('app_early_access',    'false',          'boolean', 'Early access UI')
  ) AS s(key, value, vt, descr)
ON CONFLICT (org_id, setting_key) DO NOTHING;

-- company group
INSERT INTO public.org_settings (org_id, setting_group, setting_key, setting_value, value_type, description)
SELECT o.id, 'company', s.key, s.value::jsonb, s.vt, s.descr
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('company_name',         '"COMPANY Name"',             'string', 'Display name'),
    ('company_logo',         'null',                        'image',  'Logo path'),
    ('company_icon',         'null',                        'image',  'Favicon path'),
    ('company_address',      '"25, Your Company Address"',  'string', 'Address'),
    ('company_state',        '"New York"',                  'string', 'State'),
    ('company_country',      '"United States"',             'string', 'Country'),
    ('company_email',        '"youremail@example.com"',     'string', 'Email'),
    ('company_phone',        '"+1 345234654"',              'string', 'Phone'),
    ('company_website',      '"www.example.com"',           'string', 'Website'),
    ('company_tax_number',   '"91231255234"',               'string', 'Tax number'),
    ('company_vat_number',   '"91231255234"',               'string', 'VAT number'),
    ('company_reg_number',   '"00001231421"',               'string', 'Registration / EIN'),
    ('company_bank_account', '"iban: 00001231421"',         'string', 'Bank account text')
  ) AS s(key, value, vt, descr)
ON CONFLICT (org_id, setting_key) DO NOTHING;

-- money_format group
INSERT INTO public.org_settings (org_id, setting_group, setting_key, setting_value, value_type, description)
SELECT o.id, 'money_format', s.key, s.value::jsonb, s.vt, s.descr
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('default_currency_code','"USD"',        'string',  'Default currency'),
    ('currency_name',        '"US Dollars"', 'string',  'Display label'),
    ('currency_symbol',      '"$"',          'string',  'Symbol'),
    ('currency_position',    '"before"',     'string',  'Symbol position'),
    ('decimal_sep',          '"."',          'string',  'Decimal separator'),
    ('thousand_sep',         '","',          'string',  'Thousands separator'),
    ('cent_precision',       '2',            'number',  'Display precision'),
    ('zero_format',          'false',        'boolean', 'Zero as blank')
  ) AS s(key, value, vt, descr)
ON CONFLICT (org_id, setting_key) DO NOTHING;

-- client group
INSERT INTO public.org_settings (org_id, setting_group, setting_key, setting_value, value_type, description)
SELECT o.id, 'client', s.key, s.value::jsonb, s.vt, s.descr
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('client_type',     '["people","company"]',                                                          'array',  'Allowed client types'),
    ('client_status',   '["active","new","premium","unactive"]',                                          'array',  'Allowed client statuses'),
    ('client_source',   '["self checking","sales lead","recommendation","facebook","instagram","tiktok","youtube","blog","linkedin","newsletter","website","twitter"]', 'array', 'Allowed client sources'),
    ('client_category', '["Corporate","startup","small company","services business","retails","cafe & restaurant"]', 'array', 'Allowed client categories'),
    ('invoice_default_client_type', '"company"', 'string', 'Default client type for invoice'),
    ('quote_default_client_type',   '"company"', 'string', 'Default client type for quote')
  ) AS s(key, value, vt, descr)
ON CONFLICT (org_id, setting_key) DO NOTHING;

-- invoice group
INSERT INTO public.org_settings (org_id, setting_group, setting_key, setting_value, value_type, description)
SELECT o.id, 'invoice', s.key, s.value::jsonb, s.vt, s.descr
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('invoice_show_product_tax', 'false',                                                                                  'boolean','Show tax column'),
    ('invoice_pdf_footer',       '"Invoice was created on a computer and is valid without the signature and seal"',         'string', 'PDF footer')
  ) AS s(key, value, vt, descr)
ON CONFLICT (org_id, setting_key) DO NOTHING;

-- quote group
INSERT INTO public.org_settings (org_id, setting_group, setting_key, setting_value, value_type, description)
SELECT o.id, 'quote', s.key, s.value::jsonb, s.vt, s.descr
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('quote_show_product_tax', 'false',                                                                                  'boolean','Show tax column'),
    ('quote_pdf_footer',       '"Quote was created on a computer and is valid without the signature and seal"',          'string', 'PDF footer')
  ) AS s(key, value, vt, descr)
ON CONFLICT (org_id, setting_key) DO NOTHING;

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

COMMIT;
