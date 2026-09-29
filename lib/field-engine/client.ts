'use client';

import { supabase } from '@/lib/supabase/client';
import type { FieldDefinition } from '@/lib/types';

export async function fetchFieldDefinitions(moduleKey: string): Promise<FieldDefinition[]> {
  const { data, error } = await supabase
    .from('field_definitions')
    .select('*')
    .eq('module_key', moduleKey)
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw error;
  return (data || []) as unknown as FieldDefinition[];
}

export async function fetchAllFieldDefinitions(moduleKey: string): Promise<FieldDefinition[]> {
  const { data, error } = await supabase
    .from('field_definitions')
    .select('*')
    .eq('module_key', moduleKey)
    .order('sort_order');

  if (error) throw error;
  return (data || []) as unknown as FieldDefinition[];
}

export async function createFieldDefinition(
  field: Omit<FieldDefinition, 'id' | 'created_at' | 'updated_at'>
): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from('field_definitions')
    .insert(field)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as FieldDefinition;
}

export async function updateFieldDefinition(
  id: string,
  updates: Partial<FieldDefinition>
): Promise<FieldDefinition> {
  const { data, error } = await supabase
    .from('field_definitions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as FieldDefinition;
}

export async function deleteFieldDefinition(id: string): Promise<void> {
  const { error } = await supabase
    .from('field_definitions')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function fetchFieldValues(
  moduleKey: string,
  recordId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('field_values')
    .select('*')
    .eq('module_key', moduleKey)
    .eq('record_id', recordId);

  if (error) throw error;

  const values: Record<string, unknown> = {};
  for (const fv of data || []) {
    values[fv.field_key] = fv.value;
  }
  return values;
}

export async function saveFieldValues(
  moduleKey: string,
  recordId: string,
  values: Record<string, unknown>
): Promise<void> {
  const rows = Object.entries(values).map(([fieldKey, value]) => ({
    module_key: moduleKey,
    record_id: recordId,
    field_key: fieldKey,
    value: value as unknown,
  }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('field_values')
    .upsert(rows, { onConflict: 'module_key,record_id,field_key' });

  if (error) throw error;
}
