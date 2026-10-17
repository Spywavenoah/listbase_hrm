'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

export interface Course {
  id: string;
  title: string;
}

interface Department {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  first_name: string;
  last_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  course: Course | null;
  onAssigned: () => void;
}

export function AssignCourseDialog({ open, onOpenChange, course, onAssigned }: Props) {
  const [mode, setMode] = useState<'all' | 'department' | 'employees'>('all');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadDeps();
      setMode('all');
      setDepartmentId('');
      setSelected(new Set());
    }
  }, [open]);

  const loadDeps = async () => {
    try {
      const [dRes, eRes] = await Promise.all([
        supabase.from('departments').select('id, name').order('name'),
        supabase
          .from('employees')
          .select('id, first_name, last_name')
          .eq('employment_status', 'ACTIVE')
          .order('last_name'),
      ]);
      setDepartments(dRes.data || []);
      setEmployees(eRes.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleEmp = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (checked: boolean) => {
    if (checked) setSelected(new Set(employees.map((e) => e.id)));
    else setSelected(new Set());
  };

  const assign = async () => {
    if (!course) return;
    setLoading(true);
    try {
      const params: Record<string, unknown> = { p_course_id: course.id };
      if (mode === 'department' && departmentId) params.p_department_id = departmentId;
      if (mode === 'employees' && selected.size > 0) params.p_employee_ids = Array.from(selected);
      const { data, error } = await supabase.rpc('assign_training_course', params);
      if (error) throw error;
      const enrolled = Number((data as { enrolled?: number })?.enrolled || 0);
      toast.success(`Assigned to ${enrolled} employee${enrolled === 1 ? '' : 's'}`);
      onAssigned();
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const canAssign = () => {
    if (!course) return false;
    if (mode === 'department') return Boolean(departmentId);
    if (mode === 'employees') return selected.size > 0;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Assign training — {course?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label>Assign to</Label>
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All active employees</SelectItem>
                <SelectItem value="department">Specific department</SelectItem>
                <SelectItem value="employees">Selected employees</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'department' && (
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'employees' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Employees ({selected.size} selected)</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => selectAll(selected.size !== employees.length)}>
                  {selected.size !== employees.length ? 'Select all' : 'Clear'}
                </Button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {employees.map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
                    <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggleEmp(e.id)} />
                    <span className="text-sm">{e.first_name} {e.last_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={assign} disabled={!canAssign() || loading}>{loading ? 'Assigning…' : 'Assign'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
