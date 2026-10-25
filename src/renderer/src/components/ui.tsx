import type { ReactNode } from "react";

export const inputClass =
  "w-80 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 " +
  "dark:border-gray-700 dark:bg-gray-900";

export const secondaryButtonClass =
  "rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50 " +
  "dark:border-gray-700 dark:hover:bg-gray-800";

/** A form row: label on the left, controls on the right. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-4">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex min-w-0 items-center gap-3">{children}</div>
    </div>
  );
}

/** Small text under a Field, aligned with its controls (6rem label column + 1rem gap). */
export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="-mt-2 pl-28 text-xs text-gray-500">{children}</p>;
}

export function Segmented<T extends string | number>({
  options,
  value,
  disabled,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            value === option.value ? "bg-blue-600 text-white" : "hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm has-disabled:opacity-50">
      <input
        type="checkbox"
        className="size-4 accent-blue-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {children}
    </div>
  );
}
