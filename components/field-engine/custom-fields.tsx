'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchFieldDefinitions } from '@/lib/field-engine/client';
import { isDependentField } from '@/lib/field-engine/types';
import type { FieldDefinition } from '@/lib/types';
import { cn } from '@/lib/utils';

// Renders the active, non-dependent custom fields for a module during data entry.
export function CustomFieldsBlock({
  moduleKey,
  values,
  onChange,
  disabled = false,
}: {
  moduleKey: string;
  values: Record<string, unknown>;
  onChange: (fieldKey: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const [defs, setDefs] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchFieldDefinitions(moduleKey)
      .then((fields) => {
        const shown = (fields || []).filter((f) => !isDependentField(f));
        if (!active) return;
        setDefs(shown);
        for (const f of shown) {
          if (values[f.field_key] === undefined && f.default_value !== undefined && f.default_value !== null) {
            onChange(f.field_key, f.default_value as unknown);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey]);

  if (loading) return <div className="h-14 animate-pulse rounded-lg bg-muted" />;
  if (defs.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm font-medium text-muted-foreground">Additional Information</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((f) => (
          <CustomFieldEditor key={f.field_key} field={f} value={values[f.field_key]} disabled={disabled} onChange={(v) => onChange(f.field_key, v)} />
        ))}
      </div>
    </div>
  );
}

export function CustomFieldEditor({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const required = field.is_required;
  const label = (
    <Label className="text-sm font-medium">
      {field.label}
      {required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  );

  switch (field.data_type) {
    case 'NUMBER':
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="number"
            disabled={disabled}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      );
    case 'DATE':
      return (
        <div className="space-y-1.5">
          {label}
          <Input type="date" disabled={disabled} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'BOOLEAN':
      return (
        <div className="flex h-10 items-center gap-2">
          <Checkbox id={field.field_key} disabled={disabled} checked={!!value} onCheckedChange={(c) => onChange(c === true)} />
          <Label htmlFor={field.field_key} className="text-sm text-muted-foreground">{field.label}</Label>
        </div>
      );
    case 'SELECT':
      return (
        <div className="space-y-1.5">
          {label}
          <Select value={(value as string) || ''} disabled={disabled} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
            <SelectContent>
              {(field.options || []).map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      );
    case 'MULTISELECT':
      return (
        <div className="space-y-1.5">
          {label}
          <div className="flex flex-wrap gap-2 rounded-md border border-input p-2 min-h-10">
            {(field.options || []).map((opt) => {
              const selected = Array.isArray(value) && (value as unknown[]).includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const current = Array.isArray(value) ? (value as unknown[]) : [];
                    onChange(selected ? current.filter((v) => v !== opt) : [...current, opt]);
                  }}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );
    case 'FILE':
      return (
        <div className="space-y-1.5">
          {label}
          <Input type="file" disabled={disabled} onChange={(e) => onChange(e.target.files?.[0]?.name || '')} />
        </div>
      );
    default:
      return (
        <div className="space-y-1.5">
          {label}
          <Input disabled={disabled} value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}