'use client';
import { optionValue, type Field, type FieldOption } from '@force-pulse/shared';
import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Values = Record<string, unknown>;

const optionLabel = (o: FieldOption) => (typeof o === 'string' ? o : (o.label ?? o.value));
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm';

/**
 * Renders one rule-pack field. Knows field *types*, never sports: everything sport-specific comes
 * from the pack (ADR-001).
 */
export function DynamicField({
  field,
  register,
  control,
  errors,
}: {
  field: Field;
  register: UseFormRegister<Values>;
  control: Control<Values>;
  errors: FieldErrors<Values>;
}) {
  const id = `f-${field.key}`;
  const error = errors[field.key]?.message as string | undefined;
  const label = (
    <Label htmlFor={id}>
      {field.label}
      {field.required && <span className="text-destructive"> *</span>}
    </Label>
  );

  let input: React.ReactNode;
  switch (field.type) {
    case 'select':
      input = (
        <select
          id={id}
          className={selectClass}
          {...register(field.key, { setValueAs: emptyToUndefined })}
        >
          <option value="">Choose…</option>
          {field.options.map((o) => (
            <option key={optionValue(o)} value={optionValue(o)}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      );
      break;
    case 'multiselect':
      input = (
        <Controller
          name={field.key}
          control={control}
          render={({ field: f }) => {
            const picked = (f.value as string[] | undefined) ?? [];
            return (
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
                {field.options.map((o) => {
                  const v = optionValue(o);
                  const on = picked.includes(v);
                  return (
                    <label
                      key={v}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 ${on ? 'border-primary bg-muted' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = on ? picked.filter((x) => x !== v) : [...picked, v];
                          f.onChange(next.length ? next : undefined);
                        }}
                      />
                      {optionLabel(o)}
                    </label>
                  );
                })}
              </div>
            );
          }}
        />
      );
      break;
    case 'number':
      input = (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          {...register(field.key, { setValueAs: (v) => (v === '' ? undefined : Number(v)) })}
        />
      );
      break;
    case 'list':
      input = (
        <Controller
          name={field.key}
          control={control}
          render={({ field: f }) => (
            <Textarea
              id={id}
              rows={3}
              placeholder="One per line"
              value={((f.value as string[] | undefined) ?? []).join('\n')}
              onChange={(e) => {
                const items = e.target.value.split('\n');
                // Keep the trailing empty line while typing; drop blanks when saving.
                f.onChange(items.some((x) => x.trim()) ? items : undefined);
              }}
              onBlur={() => {
                const items = ((f.value as string[] | undefined) ?? [])
                  .map((x) => x.trim())
                  .filter(Boolean);
                f.onChange(items.length ? items : undefined);
              }}
            />
          )}
        />
      );
      break;
    default:
      input = (
        <Input
          id={id}
          type={field.type === 'url' ? 'url' : 'text'}
          maxLength={field.type === 'text' ? field.maxLength : undefined}
          {...register(field.key, { setValueAs: emptyToUndefined })}
        />
      );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {input}
      {field.help && <p className="text-sm text-muted-foreground">{field.help}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
