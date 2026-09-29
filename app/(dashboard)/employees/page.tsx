'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleListPage, type SummaryCard, type Column } from '@/components/shared/module-list-page';
import { Users, UserPlus, UserCheck, UserX, Eye, Pencil, Send, Ban } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { Employee } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { enqueueAndProcess } from '@/lib/notifications';
import { useAccess } from '@/lib/access';
import { PRIVILEGE_CATEGORIES, ROLE_OPTIONS, SELF_SERVICE_PRIVILEGE, type PrivilegeCategory } from '@/lib/privileges';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-success/10 text-success border-success/20',
  PENDING_VERIFICATION: 'bg-warning/10 text-warning border-warning/20',
  ONBOARDING: 'bg-info/10 text-info border-info/20',
  ON_LEAVE: 'bg-primary/10 text-primary border-primary/20',
  TERMINATED: 'bg-destructive/10 text-destructive border-destructive/20',
};

async function createSetupToken(employeeId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_setup_token', { p_employee_id: employeeId });
  if (error) throw new Error(`Failed to generate setup link: ${error.message}`);
  if (!data) throw new Error('Failed to generate setup link');
  return data as string;
}

export default function EmployeesPage() {
  const router = useRouter();
  const { can, employeeId: myId } = useAccess();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [newEmp, setNewEmp] = useState({ first_name: '', last_name: '', email: '', employee_id: '' });
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string>('__all__');
  const [gradeColumn, setGradeColumn] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [editRole, setEditRole] = useState('EMPLOYEE');
  const [editPrivileges, setEditPrivileges] = useState<Set<string>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);
  const [disableTarget, setDisableTarget] = useState<Employee | null>(null);
  const [disabling, setDisabling] = useState(false);

  const canManage = can('employees.manage');
  const canManageAccess = can('admin.privileges');
  const canInvite = can('employees.invite');
  const canCreate = canManage || canInvite;

  const loadEmployees = useCallback(async () => {
    try {
      setLoading(true);
      const [empRes, deptRes] = await Promise.all([
        supabase.from('employees').select('*').order('created_at', { ascending: false }),
        supabase.from('departments').select('id, name'),
      ]);
      if (empRes.error) throw empRes.error;
      setEmployees((empRes.data || []) as unknown as Employee[]);
      setDepartments((deptRes.data || []) as { id: string; name: string }[]);
    } catch (err) {
      console.error('Failed to load employees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const handleCreate = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmp.email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert({
          ...newEmp,
          employment_status: 'PENDING_VERIFICATION',
        })
        .select()
        .single();
      if (error) throw error;
      toast.success('Employee created successfully');
      setCreateOpen(false);
      setNewEmp({ first_name: '', last_name: '', email: '', employee_id: '' });
      loadEmployees();

      const setupToken = await createSetupToken(data.id);
      const setupLink = `${window.location.origin}/setup-account?token=${setupToken}`;
      await enqueueAndProcess({
        eventKey: 'welcome.new_employee',
        recipientEmail: newEmp.email,
        recipientName: `${newEmp.first_name} ${newEmp.last_name}`,
        subject: `Welcome to the team, ${newEmp.first_name}!`,
        bodyHtml: `<p>Hi ${newEmp.first_name},</p><p>Welcome aboard! Your employee account has been created. Click the link below to set up your password and start onboarding:</p><p><a href="${setupLink}">Start Onboarding</a></p>`,
        metadata: {
          employee_name: `${newEmp.first_name} ${newEmp.last_name}`,
          employee_email: newEmp.email,
          first_name: newEmp.first_name,
          company_name: 'HRM Flow',
          setup_link: setupLink,
        },
      });

      router.push(`/employees/${data.id}/personal`);
    } catch (err) {
      toast.error('Failed to create employee: ' + (err as Error).message);
    }
  };

  const handleResendInvitation = async (emp: Employee) => {
    setResending(emp.id);
    try {
      const setupToken = await createSetupToken(emp.id);
      const setupLink = `${window.location.origin}/setup-account?token=${setupToken}`;
      await enqueueAndProcess({
        eventKey: 'password.setup',
        recipientEmail: emp.email,
        recipientName: `${emp.first_name} ${emp.last_name}`,
        subject: `Set up your HR Flow account, ${emp.first_name}`,
        bodyHtml: `<p>Hi ${emp.first_name},</p><p>An account has been created for you on HR Flow. Click the link below to set your password and start onboarding:</p><p><a href="${setupLink}">Set Up Your Account</a></p>`,
        metadata: {
          employee_name: `${emp.first_name} ${emp.last_name}`,
          employee_email: emp.email,
          first_name: emp.first_name,
          company_name: 'HRM Flow',
          setup_link: setupLink,
        },
      });
      toast.success(`Invitation resent to ${emp.email}`);
    } catch (err) {
      toast.error('Failed to resend: ' + (err as Error).message);
    } finally {
      setResending(null);
    }
  };

  const openEditAccess = async (emp: Employee) => {
    setEditing(emp);
    setEditRole(emp.role || 'EMPLOYEE');
    const { data: grants, error } = await supabase
      .from('employee_privileges')
      .select('privilege_key')
      .eq('employee_id', emp.id);
    if (error) {
      toast.error('Failed to load privileges: ' + error.message);
      return;
    }
    setEditPrivileges(
      new Set(
        (grants || [])
          .map((g) => (g as { privilege_key: string }).privilege_key)
          .filter((key) => key !== SELF_SERVICE_PRIVILEGE.key)
      )
    );
    setEditOpen(true);
  };

  const togglePrivilege = (key: string) => {
    if (!key || key === SELF_SERVICE_PRIVILEGE.key) return;
    setEditPrivileges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCategory = (cat: PrivilegeCategory) => {
    const allSelected = cat.privileges.every((p) => editPrivileges.has(p.key));
    setEditPrivileges((prev) => {
      const next = new Set(prev);
      for (const p of cat.privileges) {
        if (allSelected) next.delete(p.key);
        else next.add(p.key);
      }
      return next;
    });
  };

  const handleSaveAccess = async () => {
    if (!editing) return;
    setSavingAccess(true);
    try {
      const { error } = await supabase.rpc('set_employee_access', {
        p_employee_id: editing.id,
        p_role: editRole,
        p_privileges: Array.from(editPrivileges),
      });
      if (error) throw error;
      toast.success('Employee access updated');
      setEditOpen(false);
      loadEmployees();
    } catch (err) {
      toast.error('Failed to update access: ' + (err as Error).message);
    } finally {
      setSavingAccess(false);
    }
  };

  const handleDisable = async () => {
    if (!disableTarget) return;
    if (disableTarget.id === myId) {
      toast.error('You cannot disable your own account');
      setDisableTarget(null);
      return;
    }
    setDisabling(true);
    try {
      const { error } = await supabase.rpc('set_employee_disabled', {
        p_employee_id: disableTarget.id,
        p_disabled: true,
      });
      if (error) throw error;
      toast.success(`${disableTarget.first_name} has been disabled`);
      setDisableTarget(null);
      loadEmployees();
    } catch (err) {
      toast.error('Failed to disable: ' + (err as Error).message);
    } finally {
      setDisabling(false);
    }
  };

  const handleEnable = async (emp: Employee) => {
    try {
      const { error } = await supabase.rpc('set_employee_disabled', {
        p_employee_id: emp.id,
        p_disabled: false,
      });
      if (error) throw error;
      toast.success(`${emp.first_name} has been re-enabled`);
      loadEmployees();
    } catch (err) {
      toast.error('Failed to re-enable: ' + (err as Error).message);
    }
  };

  const summaryCards: SummaryCard[] = [
    { label: 'Total Employees', value: employees.length, icon: Users, color: 'primary' },
    { label: 'Active', value: employees.filter((e) => e.employment_status === 'ACTIVE').length, icon: UserCheck, color: 'success' },
    { label: 'Pending Onboarding', value: employees.filter((e) => e.employment_status === 'PENDING_VERIFICATION').length, icon: UserPlus, color: 'warning' },
    { label: 'Terminated', value: employees.filter((e) => e.employment_status === 'TERMINATED').length, icon: UserX, color: 'destructive' },
  ];

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name || '—';

  const filteredEmployees = departmentFilter === '__all__'
    ? employees
    : employees.filter((e) => e.department_id === departmentFilter);

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (emp) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {emp.first_name[0]}{emp.last_name[0]}
          </div>
          <div>
            <p className="font-medium">{emp.first_name} {emp.last_name}</p>
            <p className="text-xs text-muted-foreground">{emp.employee_id || '—'}</p>
          </div>
        </div>
      ),
    },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone', render: (e) => e.phone || '—' },
    {
      key: 'department_id',
      label: 'Department',
      render: (e) => <span className="text-sm">{deptName(e.department_id)}</span>,
    },
    {
      key: 'compensation_grade',
      label: 'Grade',
      render: (e) => e.compensation_grade ? <span className="text-sm">{e.compensation_grade}</span> : '—',
    },
    {
      key: 'employment_type',
      label: 'Type',
      render: (e) => <span className="text-sm">{e.employment_type.replace('_', ' ')}</span>,
    },
    {
      key: 'employment_status',
      label: 'Status',
      render: (e) => (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={statusColors[e.employment_status] || ''}>
            {e.employment_status.replace(/_/g, ' ')}
          </Badge>
          {e.is_login_blocked && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
              Disabled
            </Badge>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ModuleListPage
        title="Employees"
        description="Manage your organization's employee records"
        summaryCards={summaryCards}
        columns={columns}
        data={filteredEmployees}
        searchPlaceholder="Search employees..."
        statusKey="employment_status"
        toolbarActions={
          departments.length > 0 ? (
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
        createLabel="Add Employee"
        onCreate={canCreate ? () => setCreateOpen(true) : undefined}
        onRowClick={(emp) => router.push(`/employees/${emp.id}/personal`)}
        rowActions={(emp) => (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="View profile"
              onClick={(e) => { e.stopPropagation(); router.push(`/employees/${emp.id}/personal`); }}
            >
              <Eye className="h-4 w-4" />
            </Button>
            {canManageAccess && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-primary"
                title="Edit privileges"
                onClick={(e) => { e.stopPropagation(); openEditAccess(emp); }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canInvite && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Resend invitation"
                disabled={resending === emp.id}
                onClick={(e) => { e.stopPropagation(); handleResendInvitation(emp); }}
              >
                <Send className={`h-4 w-4 ${resending === emp.id ? 'animate-pulse' : ''}`} />
              </Button>
            )}
            {canManage &&
              (emp.is_login_blocked ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-success"
                  title="Re-enable account"
                  onClick={(e) => { e.stopPropagation(); handleEnable(emp); }}
                >
                  <UserCheck className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  title="Disable account"
                  onClick={(e) => { e.stopPropagation(); setDisableTarget(emp); }}
                >
                  <Ban className="h-4 w-4" />
                </Button>
              ))}
          </div>
        )}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Access</DialogTitle>
            <DialogDescription>
              {editing && (
                <>Assign privileges and role for <strong>{editing.first_name} {editing.last_name}</strong> ({editing.email})</>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                SUPER_ADMIN gets all privileges automatically. The role is used for coarse UI filtering and special guards.
              </p>
            </div>

            <div className="space-y-4">
              <Label>Module Privileges</Label>
              <div className="rounded-lg border border-border bg-primary/5 px-4 py-2.5">
                <label className="flex cursor-not-allowed items-center gap-3 opacity-80">
                  <Checkbox checked disabled className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{SELF_SERVICE_PRIVILEGE.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{SELF_SERVICE_PRIVILEGE.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">Default</span>
                </label>
              </div>

              {PRIVILEGE_CATEGORIES.map((cat) => {
                const allSelected = cat.privileges.every((p) => editPrivileges.has(p.key));
                const someSelected = cat.privileges.some((p) => editPrivileges.has(p.key));

                return (
                  <div key={cat.key} className="rounded-lg border border-border">
                    <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
                      <Checkbox
                        checked={someSelected ? (allSelected ? true : 'indeterminate') : false}
                        onCheckedChange={() => toggleCategory(cat)}
                      />
                      <span className="text-sm font-semibold">{cat.label}</span>
                      {someSelected && !allSelected && (
                        <span className="text-xs text-muted-foreground">
                          ({cat.privileges.filter((p) => editPrivileges.has(p.key)).length}/{cat.privileges.length})
                        </span>
                      )}
                    </div>
                    <div className="grid gap-0 px-4 py-1">
                      {cat.privileges.map((priv) => (
                        <label
                          key={priv.key}
                          className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={editPrivileges.has(priv.key)}
                            onCheckedChange={() => togglePrivilege(priv.key)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-none">{priv.label}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{priv.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 bg-card border-t border-border -mx-6 -mb-6 px-6 py-4 rounded-b-xl">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveAccess} disabled={savingAccess}>
              {savingAccess ? 'Saving...' : 'Save Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!disableTarget}
        onOpenChange={(open) => { if (!open) setDisableTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable this employee?</AlertDialogTitle>
            <AlertDialogDescription>
              This will block <strong>{disableTarget?.first_name} {disableTarget?.last_name}</strong> from logging in. Their record and data will remain intact. You can re-enable them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={disabling}
              onClick={handleDisable}
            >
              {disabling ? 'Disabling...' : 'Disable'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Register Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Enter the basics — the employee will complete their full profile via self-onboarding.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>First Name *</Label>
                <Input
                  value={newEmp.first_name}
                  onChange={(e) => setNewEmp({ ...newEmp, first_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last Name *</Label>
                <Input
                  value={newEmp.last_name}
                  onChange={(e) => setNewEmp({ ...newEmp, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                value={newEmp.email}
                onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Staff ID</Label>
              <Input
                value={newEmp.employee_id}
                onChange={(e) => setNewEmp({ ...newEmp, employee_id: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newEmp.first_name || !newEmp.email}>
              Create & Send Invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
