'use client';

import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

export interface ProcurementEmployee {
  id: string;
  employee_id: string;
  name: string;
  email: string | null;
  department_name: string | null;
  position_name: string | null;
}

export interface ProcurementEmployeePickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}

export function ProcurementEmployeePicker({
  value,
  onChange,
  placeholder = 'Select employee',
  disabled,
  allowEmpty = false,
}: ProcurementEmployeePickerProps) {
  const [employees, setEmployees] = useState<ProcurementEmployee[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_procurement_employee_list');
        if (error) throw error;
        if (!cancelled) setEmployees((data || []) as ProcurementEmployee[]);
      } catch (err) {
        if (!cancelled) toast.error('Failed to load employees: ' + (err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Select
      value={value || ''}
      onValueChange={(v) => onChange(v === 'none' ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && (
          <SelectItem value="none">None</SelectItem>
        )}
        {!loaded && <div className="px-3 py-2 text-sm text-muted-foreground">Loading employees...</div>}
        {loaded && employees.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">No employees found</div>
        )}
        {employees.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name}
            {e.department_name ? ` — ${e.department_name}` : ''}
            {e.position_name ? ` · ${e.position_name}` : ''}
            {e.employee_id ? ` (${e.employee_id})` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}