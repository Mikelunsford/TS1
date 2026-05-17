/**
 * Receipt URL input. Until the attachments service lands, expenses just
 * carry a `receipt_url` text field that a user can paste into. Accepts
 * any string up to 2048 chars (matches the BE schema).
 */
interface Props {
  value: string;
  onChange: (url: string) => void;
  id?: string;
  disabled?: boolean;
}

export function ReceiptUploader({ value, onChange, id, disabled }: Props) {
  return (
    <div className="space-y-1">
      <input
        id={id}
        type="url"
        value={value}
        disabled={disabled}
        maxLength={2048}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://…/receipt.pdf"
        className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        data-testid="receipt-url-input"
      />
      <p className="text-xs text-fg-subtle">
        Paste a receipt URL. File uploads coming with attachments.
      </p>
    </div>
  );
}
