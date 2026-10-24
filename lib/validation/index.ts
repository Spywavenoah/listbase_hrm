import { z, type ZodSchema, type ZodTypeAny, type ZodError } from 'zod';

/**
 * Common validation patterns reused across forms.
 */
export const patterns = {
  email: z
    .string()
    .email('Invalid email address')
    .min(1, 'Email is required'),
  required: (message = 'This field is required') =>
    z.string().min(1, message),
  minLength: (min: number, message?: string) =>
    z.string().min(min, message || `Minimum ${min} characters required`),
  maxLength: (max: number, message?: string) =>
    z.string().max(max, message || `Maximum ${max} characters allowed`),
  phone: z
    .string()
    .min(1, 'Phone number is required')
    .regex(/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/, 'Invalid phone number'),
  pincode: z.string().min(1, 'PIN is required'),
  number: (message = 'Must be a valid number') =>
    z.coerce.number(message),
  positive: (message = 'Must be greater than 0') =>
    z.coerce.number().positive(message),
  nonNegative: (message = 'Must be 0 or greater') =>
    z.coerce.number().nonnegative(message),
  toggle: z.boolean(),
};

/**
 * Extract inferred type from a Zod schema.
 */
export type InferSchema<T extends ZodTypeAny> = z.infer<T>;

/**
 * Validate a single field value against a schema and return the error message (if any).
 * Useful for live (on-change) validation.
 */
export function validateField<T extends ZodTypeAny>(
  schema: T,
  value: unknown
): string | null {
  try {
    schema.parse(value);
    return null;
  } catch (err) {
    if (err instanceof ZodError) {
      return err.errors[0]?.message ?? 'Invalid value';
    }
    return 'Invalid value';
  }
}