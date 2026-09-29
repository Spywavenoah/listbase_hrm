import { z } from 'zod';
import type { FieldDataType } from '@/lib/types';

export const FIELD_DATA_TYPES: FieldDataType[] = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'MULTISELECT',
  'FILE',
  'RELATION',
];

export const FIELD_DATA_TYPE_LABELS: Record<FieldDataType, string> = {
  TEXT: 'Text',
  NUMBER: 'Number',
  DATE: 'Date',
  BOOLEAN: 'Yes/No',
  SELECT: 'Single Select',
  MULTISELECT: 'Multi Select',
  FILE: 'File Upload',
  RELATION: 'Related Record',
};

export interface FieldDefinitionInput {
  id?: string;
  module_key: string;
  field_key: string;
  label: string;
  data_type: FieldDataType;
  options?: string[] | null;
  is_required: boolean;
  is_unique: boolean;
  default_value?: unknown;
  validation?: {
    min?: number;
    max?: number;
    regex?: string;
    minLength?: number;
    maxLength?: number;
  } | null;
  visibility?: Record<string, 'read' | 'edit' | 'hidden'> | null;
  section?: string | null;
  sort_order: number;
  is_system?: boolean;
  is_active?: boolean;
}

export function generateZodSchema(
  fields: FieldDefinitionInput[]
): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};

  for (const field of fields) {
    if (!field.is_active && field.is_active !== undefined) continue;

    let schema: z.ZodTypeAny;

    switch (field.data_type) {
      case 'TEXT': {
        let s = z.string();
        if (field.validation?.minLength) s = s.min(field.validation.minLength);
        if (field.validation?.maxLength) s = s.max(field.validation.maxLength);
        if (field.validation?.regex) {
          s = s.regex(new RegExp(field.validation.regex));
        }
        schema = s;
        break;
      }
      case 'NUMBER': {
        let s = z.coerce.number();
        if (field.validation?.min !== undefined) s = s.min(field.validation.min);
        if (field.validation?.max !== undefined) s = s.max(field.validation.max);
        schema = s;
        break;
      }
      case 'DATE':
        schema = z.coerce.date();
        break;
      case 'BOOLEAN':
        schema = z.boolean();
        break;
      case 'SELECT':
        schema = z.string().refine(
          (val) => !field.options || field.options.includes(val),
          { message: 'Invalid selection' }
        );
        break;
      case 'MULTISELECT':
        schema = z.array(z.string());
        break;
      case 'FILE':
        schema = z.string().url();
        break;
      case 'RELATION':
        schema = z.string().uuid();
        break;
      default:
        schema = z.any();
    }

    if (!field.is_required) {
      schema = schema.optional().or(z.literal('')).or(z.null());
    }

    shape[field.field_key] = schema;
  }

  return z.object(shape);
}

export function getFieldSections(
  fields: FieldDefinitionInput[]
): Map<string, FieldDefinitionInput[]> {
  const sections = new Map<string, FieldDefinitionInput[]>();
  for (const field of fields) {
    const section = field.section || 'General';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(field);
  }
  return sections;
}
