'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase/client';
import { fetchFieldDefinitions, fetchFieldValues, saveFieldValues } from '@/lib/field-engine/client';
import { generateZodSchema, getFieldSections, type FieldDefinitionInput } from '@/lib/field-engine/types';
import type { FieldDataType } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DynamicFormProps {
  moduleKey: string;
  recordId?: string;
  systemFields?: Record<string, unknown>;
  systemFieldDefs?: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select' | 'boolean';
    options?: string[];
    required?: boolean;
    section?: string;
  }>;
  onSubmitSystem?: (data: Record<string, unknown>) => Promise<void>;
  fetchSystemValues?: () => Promise<Record<string, unknown>>;
  submitLabel?: string;
}

export function DynamicForm({
  moduleKey,
  recordId,
  systemFields,
  systemFieldDefs = [],
  onSubmitSystem,
  fetchSystemValues,
  submitLabel = 'Save',
}: DynamicFormProps) {
  const [customFields, setCustomFields] = useState<FieldDefinitionInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const allFields: FieldDefinitionInput[] = [
    ...systemFieldDefs.map((f) => ({
      module_key: moduleKey,
      field_key: f.key,
      label: f.label,
      data_type: (f.type === 'number' ? 'NUMBER' : f.type === 'date' ? 'DATE' : f.type === 'boolean' ? 'BOOLEAN' : f.type === 'select' ? 'SELECT' : 'TEXT') as FieldDataType,
      options: f.options || null,
      is_required: f.required || false,
      is_unique: false,
      validation: null,
      visibility: null,
      section: f.section || 'System Fields',
      sort_order: 0,
      is_system: true,
      is_active: true,
    })),
    ...customFields,
  ];

  const schema = generateZodSchema(allFields);
  const sections = getFieldSections(allFields);

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: systemFields || {},
  });

  const systemPropsRef = useRef({ fetchSystemValues, systemFields });
  systemPropsRef.current = { fetchSystemValues, systemFields };
  const formRef = useRef(form);
  formRef.current = form;

  const loadCustomFields = useCallback(async () => {
    try {
      setLoading(true);
      const fields = await fetchFieldDefinitions(moduleKey);
      setCustomFields(fields as unknown as FieldDefinitionInput[]);

      const { fetchSystemValues: fetchSystem, systemFields: staticValues } = systemPropsRef.current;
      const systemValues = fetchSystem ? await fetchSystem() : staticValues || {};

      if (recordId) {
        const values = await fetchFieldValues(moduleKey, recordId);
        formRef.current.reset({ ...systemValues, ...values });
      } else {
        formRef.current.reset(systemValues);
      }
    } catch (err) {
      console.error('Failed to load fields:', err);
    } finally {
      setLoading(false);
    }
  }, [moduleKey, recordId]);

  useEffect(() => {
    loadCustomFields();
  }, [loadCustomFields]);

  const onSubmit = async (data: Record<string, unknown>) => {
    setSaving(true);
    try {
      if (onSubmitSystem) {
        const systemData: Record<string, unknown> = {};
        for (const def of systemFieldDefs) {
          systemData[def.key] = data[def.key];
        }
        await onSubmitSystem(systemData);
      }

      if (recordId && customFields.length > 0) {
        const customData: Record<string, unknown> = {};
        for (const field of customFields) {
          customData[field.field_key] = data[field.field_key];
        }
        await saveFieldValues(moduleKey, recordId, customData);
      }

      toast.success('Saved successfully');
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const sectionEntries = Array.from(sections.entries());

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
      {sectionEntries.map(([sectionName, fields]) => (
        <div key={sectionName} className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {sectionName}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <FormField
                key={field.field_key}
                field={field}
                form={form}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  field,
  form,
}: {
  field: FieldDefinitionInput;
  form: ReturnType<typeof useForm<Record<string, unknown>>>;
}) {
  const error = form.formState.errors[field.field_key]?.message as string | undefined;
  const value = form.watch(field.field_key);

  const fieldContent = () => {
    switch (field.data_type) {
      case 'TEXT':
        return (
          <Input
            {...form.register(field.field_key)}
            placeholder={field.label}
          />
        );
      case 'NUMBER':
        return (
          <Input
            type="number"
            {...form.register(field.field_key)}
            placeholder={field.label}
          />
        );
      case 'DATE':
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'w-full justify-start text-left font-normal',
                  !value && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {value ? format(new Date(value as string), 'PPP') : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={value ? new Date(value as string) : undefined}
                onSelect={(d) => form.setValue(field.field_key, d?.toISOString() || null)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        );
      case 'BOOLEAN':
        return (
          <div className="flex items-center space-x-2 h-10">
            <Checkbox
              id={field.field_key}
              checked={!!value}
              onCheckedChange={(checked) =>
                form.setValue(field.field_key, checked === true)
              }
            />
            <Label htmlFor={field.field_key} className="text-sm text-muted-foreground">
              {field.label}
            </Label>
          </div>
        );
      case 'SELECT':
        return (
          <Select
            value={(value as string) || ''}
            onValueChange={(v) => form.setValue(field.field_key, v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${field.label}`} />
            </SelectTrigger>
            <SelectContent>
              {(field.options || []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'MULTISELECT':
        return (
          <div className="flex flex-wrap gap-2 rounded-md border border-input p-2 min-h-10">
            {(field.options || []).map((opt) => {
              const selected = Array.isArray(value) && value.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    const current = Array.isArray(value) ? value : [];
                    form.setValue(
                      field.field_key,
                      selected
                        ? current.filter((v: string) => v !== opt)
                        : [...current, opt]
                    );
                  }}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        );
      case 'FILE':
        return (
          <Input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) form.setValue(field.field_key, file.name);
            }}
          />
        );
      default:
        return <Input {...form.register(field.field_key)} placeholder={field.label} />;
    }
  };

  return (
    <div className="space-y-1.5">
      {field.data_type !== 'BOOLEAN' && (
        <Label className="text-sm font-medium">
          {field.label}
          {field.is_required && <span className="ml-1 text-destructive">*</span>}
        </Label>
      )}
      {fieldContent()}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
