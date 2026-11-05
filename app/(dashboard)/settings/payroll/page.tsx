'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Search, Trash2, UserPlus, Wallet, X } from 'lucide-react';

type Mode = 'DAYS' | 'HOURS';

interface AdminEntry {
  id: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  employment_status: string | null;
}

const employeeName = (emp: EmployeeOption) => `${emp.first_name} ${emp.last_name}`.trim();

export default function PayrollSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('DAYS');
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [defaultExpectedHours, setDefaultExpectedHours] = useState('176');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [newAdmin, setNewAdmin] = useState('');

  const load = useCallback(async () => {
    try {
      const [settingsRes, employeesRes] = await Promise.all([
        supabase
          .from('system_settings')
          .select('key, value')
          .eq('group_name', 'payroll')
          .in('key', [
            'timecard_calc_mode',
            'hours_per_day',
            'default_expected_hours',
            'employee_expected_hours',
            'pension_administrators',
          ]),
        supabase
          .from('employees')
          .select('id, employee_id, first_name, last_name, employment_status')
          .order('first_name'),
      ]);

      if (employeesRes.error) throw employeesRes.error;
      if (settingsRes.error) throw settingsRes.error;
      setEmployees((employeesRes.data || []) as EmployeeOption[]);

      const map: Record<string, unknown> = {};
      for (const r of settingsRes.data || []) {
        map[r.key] = r.value;
      }
      const rawMode = map['timecard_calc_mode'];
      if (rawMode === 'HOURS') setMode('HOURS');
      const hpd = map['hours_per_day'];
      if (typeof hpd === 'number') setHoursPerDay(String(hpd));
      else if (typeof hpd === 'string') setHoursPerDay(hpd);

      const expected = map['default_expected_hours'];
      if (typeof expected === 'number') setDefaultExpectedHours(String(expected));
      else if (typeof expected === 'string') setDefaultExpectedHours(expected);

      const overridesRaw = map['employee_expected_hours'];
      if (overridesRaw && typeof overridesRaw === 'object') {
        const next: Record<string, string> = {};
        if (Array.isArray(overridesRaw)) {
          for (const entry of overridesRaw) {
            if (!entry || typeof entry !== 'object') continue;
            const obj = entry as Record<string, unknown>;
            const id = typeof obj.employee_id === 'string' ? obj.employee_id : typeof obj.id === 'string' ? obj.id : '';
            const hours = obj.expected_hours ?? obj.hours;
            if (id && typeof hours === 'number') next[id] = String(hours);
          }
        } else {
          for (const [id, hours] of Object.entries(overridesRaw as Record<string, unknown>)) {
            if (typeof hours === 'number') next[id] = String(hours);
          }
        }
        setOverrides(next);
      }

      const adminsRaw = map['pension_administrators'];
      if (Array.isArray(adminsRaw)) {
        const list = adminsRaw
          .map((a, idx) => {
            if (typeof a === 'string') return { id: `str-${idx}`, name: a };
            if (a && typeof a === 'object') {
              const obj = a as Record<string, unknown>;
              const name = typeof obj.name === 'string' ? obj.name : typeof obj.title === 'string' ? obj.title : String(Object.values(obj)[0] || '');
              return { id: (obj.id as string) || `obj-${idx}`, name };
            }
            return null;
          })
          .filter(Boolean) as AdminEntry[];
        setAdmins(list);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load payroll settings: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addAdmin = () => {
    const name = newAdmin.trim();
    if (!name) return;
    setAdmins((prev) => [...prev, { id: `new-${Date.now()}`, name }]);
    setNewAdmin('');
  };

  const removeAdmin = (id: string) => {
    setAdmins((prev) => prev.filter((a) => a.id !== id));
  };

  const overrideRows = useMemo(
    () =>
      Object.entries(overrides)
        .map(([id, hours]) => {
          const emp = employees.find((e) => e.id === id);
          return {
            id,
            name: emp ? employeeName(emp) : 'Unknown employee',
            staffId: emp?.employee_id || '',
            hours,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [overrides, employees]
  );

  const searchResults = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    if (!term) return [];
    return employees
      .filter((emp) => !overrides[emp.id])
      .filter((emp) => {
        const haystack = `${employeeName(emp)} ${emp.employee_id || ''}`.toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 6);
  }, [employeeSearch, employees, overrides]);

  const addOverride = (emp: EmployeeOption) => {
    setOverrides((prev) => ({ ...prev, [emp.id]: defaultExpectedHours }));
    setEmployeeSearch('');
  };

  const setOverrideHours = (id: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [id]: value }));
  };

  const removeOverride = (id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const hpdNum = Math.max(1, Number(hoursPerDay) || 8);
      const defaultNum = Number(defaultExpectedHours);
      const hasDefault = defaultExpectedHours.trim() !== '' && Number.isFinite(defaultNum) && defaultNum > 0;

      const overridePayload: Record<string, number> = {};
      for (const row of overrideRows) {
        if (row.hours.trim() === '') continue;
        const num = Number(row.hours);
        if (!Number.isFinite(num) || num <= 0) {
          toast.error(`Enter a valid number of expected hours for ${row.name}`);
          return;
        }
        overridePayload[row.id] = num;
      }

      const payload = [
        { group_name: 'payroll', key: 'timecard_calc_mode', value: mode },
        { group_name: 'payroll', key: 'hours_per_day', value: hpdNum },
        { group_name: 'payroll', key: 'default_expected_hours', value: hasDefault ? defaultNum : null },
        { group_name: 'payroll', key: 'employee_expected_hours', value: overridePayload },
        { group_name: 'payroll', key: 'pension_administrators', value: admins.map((a) => ({ name: a.name })) },
      ];
      const { error } = await supabase.from('system_settings').upsert(payload, { onConflict: 'group_name,key' });
      if (error) throw error;
      toast.success('Payroll settings saved');
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Wallet className="h-6 w-6" /> Payroll Settings</h1>
        <p className="text-sm text-muted-foreground">Timecard calculation, expected hours, and Nigerian payroll configuration.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timecard Calculation</CardTitle>
          <CardDescription>Control how attendance is converted to payable units for payroll.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Calculation Mode</p>
              <p className="text-xs text-muted-foreground">DAYS uses calendar working days; HOURS pays worked hours against expected hours.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${mode === 'DAYS' ? 'font-medium' : 'text-muted-foreground'}`}>Days</span>
              <Switch checked={mode === 'HOURS'} onCheckedChange={(c) => setMode(c ? 'HOURS' : 'DAYS')} />
              <span className={`text-sm ${mode === 'HOURS' ? 'font-medium' : 'text-muted-foreground'}`}>Hours</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Hours per day</Label>
            <Input type="number" min={1} step={0.5} value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} />
            <p className="text-xs text-muted-foreground">Used as the fallback when deriving expected hours in HOURS mode.</p>
          </div>
        </CardContent>
      </Card>

      {mode === 'HOURS' && (
        <Card>
          <CardHeader>
            <CardTitle>Expected Hours</CardTitle>
            <CardDescription>
              Hourly pay is prorated as worked hours ÷ expected hours, capped at the monthly salary. Set a
              default for everyone, then override individual employees where their contract differs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label>Default expected hours (all employees)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={defaultExpectedHours}
                onChange={(e) => setDefaultExpectedHours(e.target.value)}
                placeholder="e.g. 176"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to derive expected hours from working days × hours per day.
              </p>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium">Employee overrides</p>
                <p className="text-xs text-muted-foreground">Blank or removed overrides fall back to the default.</p>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Search employees to add an override..."
                  />
                </div>
                {employeeSearch.trim() !== '' && (
                  <div className="overflow-hidden rounded-lg border border-border">
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No matching employees.</p>
                    ) : (
                      searchResults.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => addOverride(emp)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span>
                            <span className="font-medium">{employeeName(emp)}</span>
                            {emp.employee_id && <span className="ml-2 text-xs text-muted-foreground">{emp.employee_id}</span>}
                          </span>
                          <UserPlus className="h-4 w-4 text-muted-foreground" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {overrideRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                    Everyone uses the default expected hours.
                  </p>
                ) : (
                  overrideRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        {row.staffId && <p className="text-xs text-muted-foreground">{row.staffId}</p>}
                      </div>
                      <Input
                        className="w-28"
                        type="number"
                        min={0}
                        step={0.5}
                        value={row.hours}
                        onChange={(e) => setOverrideHours(row.id, e.target.value)}
                        placeholder="Hours"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeOverride(row.id)}
                        title={`Remove override for ${row.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pension Administrators</CardTitle>
          <CardDescription>Dropdown options shown on employee compensation when Pension is enabled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Badge variant="outline" className="flex-1 justify-start">{a.name}</Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeAdmin(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="e.g. Stanbic IBTC Pension, ARM Pension" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAdmin()} />
            <Button variant="outline" onClick={addAdmin}><Plus className="mr-2 h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Payroll Settings'}
        </Button>
      </div>
    </div>
  );
}
