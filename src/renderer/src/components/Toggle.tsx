// Styled on/off switch used across the settings cards (replaces raw checkboxes).
export function Toggle({
  checked,
  disabled,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-200">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-white/10 transition peer-checked:bg-primary/80" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-gray-400 transition peer-checked:translate-x-4 peer-checked:bg-white" />
      </span>
    </label>
  );
}
