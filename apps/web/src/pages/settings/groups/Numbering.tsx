import { NumberingConfigEditor } from '@/components/settings/NumberingConfigEditor';

export default function NumberingPage() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-fg">Numbering</h1>
        <p className="text-sm text-fg-muted">
          Document number sequences for invoices, quotes, POs, etc.
        </p>
      </header>
      <NumberingConfigEditor />
    </section>
  );
}
