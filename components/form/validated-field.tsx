'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFormField } from '@/components/ui/form';

interface ValidatedFieldProps {
  label: string;
  error?: string | null;
  success?: boolean;
  required?: boolean;
  helperText?: string;
  children: React.ReactNode;
}

export function ValidatedField({
  label,
  error,
  success,
  required = false,
  helperText,
  children,
}: ValidatedFieldProps) {
  const hasError = !!error;
  const showSuccess = success && !hasError;

  return (
    <div className="space-y-1">
      <Label className={cn('font-medium', hasError && 'text-destructive')}>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <div className="relative">{children}</div>
      {hasError && error && (
        <p className="text-xs font-medium text-destructive flex items-center gap-1 animate-in fade-in zoom-in duration-100">
          <span className="h-3 w-3 shrink-0">⚠</span> {error}
        </p>
      )}
      {!hasError && showSuccess && (
        <p className="text-xs font-medium text-success flex items-center gap-1 animate-in fade-in zoom-in duration-100">
          <span className="h-3 w-3 shrink-0">✓</span> Looks good
        </p>
      )}
      {helperText && !hasError && !showSuccess && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}

/**
 * Wrapper for a standard input field with live validation.
 * Connects to react-hook-form field state automatically.
 */
export function ValidatedInput(props: {
  label: string;
  error?: string | null;
  success?: boolean;
  required?: boolean;
  helperText?: string;
  className?: string;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const field = useFormField();
  const hasError = !!field.error;
  const showSuccess = props.success && !hasError;

  return (
    <div className={cn('space-y-1', props.className)}>
      <Label className={cn('font-medium', hasError && 'text-destructive')}>
        {props.label}
        {props.required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input
        {...field.field}
        {...props.inputProps}
        error={hasError}
        success={showSuccess}
        className={cn(
          hasError && 'border-destructive focus-visible:ring-destructive focus-visible:border-destructive',
          showSuccess && 'border-success focus-visible:ring-success focus-visible:border-success',
          props.className
        )}
      />
      {hasError && field.error && (
        <p className="text-xs font-medium text-destructive flex items-center gap-1 animate-in fade-in zoom-in duration-100">
          <span className="h-3 w-3 shrink-0">⚠</span> {field.error.message}
        </p>
      )}
      {!hasError && showSuccess && (
        <p className="text-xs font-medium text-success flex items-center gap-1 animate-in fade-in zoom-in duration-100">
          <span className="h-3 w-3 shrink-0">✓</span> Looks good
        </p>
      )}
      {props.helperText && !hasError && !showSuccess && (
        <p className="text-xs text-muted-foreground">{props.helperText}</p>
      )}
    </div>
  );
}