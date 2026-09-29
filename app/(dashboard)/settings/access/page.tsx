'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { AccessGate, useAccess } from '@/lib/access';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Search, ChevronLeft, ChevronRight, Inbox, KeyRound, Eye, EyeOff, CheckCircle, Info, Lock } from 'lucide-react';
import { PRIVILEGE_CATEGORIES, ROLE_OPTIONS, SELF_SERVICE_PRIVILEGE, type PrivilegeCategory } from '@/lib/privileges';
import type { Employee } from '@/lib/types';

const roleColors: Record<string, string> = {
  SUPER_ADMIN: 'bg-destructive/10 text-destructive border-destructive/20',
  HR_ADMIN: 'bg-primary/10 text-primary border-primary/20',
  MANAGER: 'bg-info/10 text-info border-info/20',
  EMPLOYEE: 'bg-success/10 text-success border-success/20',
};

interface ManagedEmployee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  employment_status: string;
  privilegeCount: number;
}

const PAGE_SIZE = 10;

export default function AccessManagementPage() {
  const { employeeId: myId } = useAccess();
  const [employees, setEmployees] = useState<ManagedEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<ManagedEmployee | null>(null);
  const [selectedRole, setSelectedRole] = useState('EMPLOYEE');
  const [selectedPrivileges, setSelectedPrivileges] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [pwEmp, setPwEmp] = useState<ManagedEmployee | null>(null);
  const [pwPassword, setPwPassword] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwShow, setPwShow] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const pwChecks = {
    length: pwPassword.length >= 8,
    uppercase: /[A-Z]/.test(pwPassword),
    number: /\d/.test(pwPassword),
    match: pwPassword === pwConfirm && pwPassword.length > 0,
  };
  const pwValid = Object.values(pwChecks).every(Boolean);

  const loadEmployees = useCallback(async () => {
    try {
      const { data: emps, error } = await supabase
        .from('employees')
        .select('id, first_name, last_name, email, role, employment_status')
        .order('last_name', { ascending: true });
      if (error) throw error;

      const rows = (emps || []) as unknown as Employee[];
      const enriched: ManagedEmployee[] = await Promise.all(
        rows.map(async (e) => {
          const { data: grants } = await supabase
            .from('employee_privileges')
            .select('privilege_key')
            .eq('employee_id', e.id);
          return {
            id: e.id,
            first_name: e.first_name,
            last_name: e.last_name,
            email: e.email,
            role: e.role || 'EMPLOYEE',
            employment_status: e.employment_status,
            privilegeCount: (grants || []).length,
          };
        })
      );
      setEmployees(enriched);
    } catch (err) {
      console.error('Failed to load employees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const filtered = employees.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.first_name.toLowerCase().includes(q) ||
      e.last_name.toLowerCase().includes(q) ||
      e.email.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const openDialog = async (emp: ManagedEmployee) => {
    setTarget(emp);
    setSelectedRole(emp.role);

    const { data: grants } = await supabase
      .from('employee_privileges')
      .select('privilege_key')
      .eq('employee_id', emp.id);
    setSelectedPrivileges(
      new Set(
        (grants || [])
          .map((g: { privilege_key: string }) => g.privilege_key)
          .filter((key) => key !== SELF_SERVICE_PRIVILEGE.key)
      )
    );
    setDialogOpen(true);
  };

  const togglePrivilege = (key: string) => {
    setSelectedPrivileges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCategory = (cat: PrivilegeCategory) => {
    const allSelected = cat.privileges.every((p) => selectedPrivileges.has(p.key));
    setSelectedPrivileges((prev) => {
      const next = new Set(prev);
      for (const p of cat.privileges) {
        if (allSelected) next.delete(p.key);
        else next.add(p.key);
      }
      return next;
    });
  };

  const openPasswordDialog = (emp: ManagedEmployee) => {
    setPwEmp(emp);
    setPwPassword('');
    setPwConfirm('');
    setPwShow(false);
    setPwOpen(true);
  };

  const handleSetPassword = async () => {
    if (!pwEmp || !pwValid) return;
    setPwSaving(true);
    try {
      const { error } = await supabase.rpc('set_employee_password', {
        p_employee_id: pwEmp.id,
        p_password: pwPassword,
      });
      if (error) throw error;
      toast.success('Password set for ' + pwEmp.email);
      setPwOpen(false);
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setPwSaving(false);
    }
  };

  const handleSave = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const privilegeArray = Array.from(selectedPrivileges);
      const { error } = await supabase.rpc('set_employee_access', {
        p_employee_id: target.id,
        p_role: selectedRole,
        p_privileges: privilegeArray,
      });
      if (error) throw error;
      toast.success('Access updated');
      setDialogOpen(false);
      loadEmployees();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccessGate privilege="admin.privileges">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Privileges & Access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign module privileges and roles to employees via checkbox groups
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border p-4">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Extra Privileges</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <TableCell key={j}><div className="h-5 w-full animate-pulse rounded bg-muted" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : paged.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        <Inbox className="mx-auto h-8 w-8 opacity-40 mb-2" />
                        <p className="text-sm">No employees found</p>
                      </TableCell>
                    </TableRow>
                  ) : paged.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => openDialog(emp)}
                    >
                      <TableCell className="font-medium">
                        {emp.first_name} {emp.last_name}
                        {emp.id === myId && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{emp.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={roleColors[emp.role] || ''}>
                          {emp.role.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {emp.role === 'SUPER_ADMIN' ? (
                          <span className="text-primary font-medium">Full (implicit)</span>
                        ) : emp.privilegeCount > 0 ? (
                          <span>{emp.privilegeCount} privileges</span>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-primary" onClick={(e) => { e.stopPropagation(); openDialog(emp); }}>
                            Manage
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-muted-foreground hover:text-primary"
                            onClick={(e) => { e.stopPropagation(); openPasswordDialog(emp); }}
                          >
                            <KeyRound className="mr-1 h-3.5 w-3.5" /> Set Password
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <span>Page {page + 1} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage Access</DialogTitle>
              <DialogDescription>
                {target && (
                  <>Assign privileges and role for <strong>{target.first_name} {target.last_name}</strong> ({target.email})</>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-2">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
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
                  const allSelected = cat.privileges.every((p) => selectedPrivileges.has(p.key));
                  const someSelected = cat.privileges.some((p) => selectedPrivileges.has(p.key));

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
                            ({cat.privileges.filter((p) => selectedPrivileges.has(p.key)).length}/{cat.privileges.length})
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
                              checked={selectedPrivileges.has(priv.key)}
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
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || (target ? target.id === myId : false)}>
                {saving ? 'Saving...' : 'Save Access'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={pwOpen} onOpenChange={setPwOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Set / Reset Password</DialogTitle>
              <DialogDescription>
                {pwEmp && (
                  <>Set a new password for <strong>{pwEmp.first_name} {pwEmp.last_name}</strong> ({pwEmp.email})</>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="pw-password">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pw-password"
                    type={pwShow ? 'text' : 'password'}
                    value={pwPassword}
                    onChange={(e) => setPwPassword(e.target.value)}
                    className="pl-9 pr-9"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setPwShow(!pwShow)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {pwShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">Confirm Password</Label>
                <Input
                  id="pw-confirm"
                  type={pwShow ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>At least 8 characters, one uppercase, one number, and passwords must match.</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                  {([
                    { label: '8+ characters', met: pwChecks.length },
                    { label: 'Uppercase letter', met: pwChecks.uppercase },
                    { label: 'Number', met: pwChecks.number },
                    { label: 'Passwords match', met: pwChecks.match },
                  ] as const).map((r) => (
                    <div key={r.label} className="flex items-center gap-1.5">
                      <CheckCircle className={`h-3 w-3 ${r.met ? 'text-success' : 'text-muted-foreground/40'}`} />
                      <span className={r.met ? 'text-foreground' : 'text-muted-foreground'}>{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
              <Button onClick={handleSetPassword} disabled={pwSaving || !pwValid}>
                {pwSaving ? 'Saving...' : 'Set Password'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AccessGate>
  );
}