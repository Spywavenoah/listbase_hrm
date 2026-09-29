'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase/client';
import { Building2, Users, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  head_id: string | null;
}

interface DepartmentNode {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  head_id: string | null;
  children: DepartmentNode[];
  members: EmployeeRow[];
}

interface EmployeeRow {
  id: string;
  first_name: string;
  last_name: string;
  department_id: string | null;
  position_id: string | null;
  compensation_grade: string | null;
  employment_status: string;
}

const statusDot: Record<string, string> = {
  ACTIVE: 'bg-success',
  ONBOARDING: 'bg-info',
  PENDING_VERIFICATION: 'bg-warning',
  ON_LEAVE: 'bg-primary',
  TERMINATED: 'bg-destructive',
};

export default function OrgChartPage() {
  const [nodes, setNodes] = useState<DepartmentNode[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const buildTree = useCallback((depts: { id: string; name: string; description: string | null; parent_id: string | null; head_id: string | null }[]) => {
    const map = new Map<string, DepartmentNode>();
    depts.forEach((d) => map.set(d.id, { ...d, children: [], members: [] }));
    const roots: DepartmentNode[] = [];
    depts.forEach((d) => {
      const node = map.get(d.id)!;
      if (d.parent_id && map.has(d.parent_id)) {
        map.get(d.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, []);

  const load = useCallback(async () => {
    try {
      const [deptRes, empRes] = await Promise.all([
        supabase.from('departments').select('id, name, description, parent_id, head_id').order('name'),
        supabase.from('employees').select('id, first_name, last_name, department_id, position_id, compensation_grade, employment_status'),
      ]);
      if (deptRes.error) throw deptRes.error;
      if (empRes.error) throw empRes.error;
      const roots = buildTree((deptRes.data || []) as DepartmentRow[]);
      const memberRows = (empRes.data || []) as EmployeeRow[];
      const deptIds = new Set((deptRes.data || []).map((d) => d.id));

      const attach = (node: DepartmentNode) => {
        node.members = memberRows.filter((e) => e.department_id === node.id);
        node.children.forEach(attach);
      };
      roots.forEach(attach);

      // Top-level members not attached to any department
      const unattached = memberRows.filter((e) => !e.department_id || !deptIds.has(e.department_id));
      setNodes(roots);
      setEmployees(unattached);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [buildTree]);

  useEffect(() => { load(); }, [load]);

  const match = (n: DepartmentNode) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (n.name.toLowerCase().includes(q)) return true;
    return n.members.some((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q));
  };

  const countMembers = (n: DepartmentNode): number => {
    return n.members.length + n.children.reduce((acc, c) => acc + countMembers(c), 0);
  };

  const renderNode = (node: DepartmentNode, depth: number) => {
    const isCollapsed = collapsed.has(node.id);
    const visible = match(node) || node.children.some(match);
    if (!visible) return null;

    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent/50',
            depth > 0 && 'ml-6'
          )}
        >
          {node.children.length > 0 && (
            <button
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent"
              onClick={() => {
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                });
              }}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{node.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {countMembers(node)} employee{countMembers(node) !== 1 ? 's' : ''}
              {node.description ? ` · ${node.description}` : ''}
            </p>
          </div>
          <Link href={`/organization/departments`} className="opacity-0 transition-opacity group-hover:opacity-100">
            <Button variant="ghost" size="sm" className="h-7 text-xs">Manage</Button>
          </Link>
        </div>

        {!isCollapsed && (
          <div className="mt-1.5 space-y-1.5">
            {node.members.map((m) => (
              <Link
                key={m.id}
                href={`/employees/${m.id}/personal`}
                className="ml-12 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 transition-colors hover:bg-accent/50"
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot[m.employment_status] || 'bg-muted')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.first_name} {m.last_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.position_id ? 'Position assigned' : 'Member'}{' '}
                    {m.compensation_grade ? `· ${m.compensation_grade}` : ''}
                  </span>
                </span>
              </Link>
            ))}
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Organization Chart</h1>
          <p className="mt-1 text-sm text-muted-foreground">Department hierarchy and headcount at a glance</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search departments or people..."
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {loading ? (
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          ) : nodes.length === 0 && employees.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Users className="h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">No departments yet</p>
              <p className="text-xs">Create departments to build your organization chart.</p>
              <Link href="/organization/departments">
                <Button variant="outline" size="sm" className="mt-2">Add Department</Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <div className="min-w-[560px] space-y-1.5">
                {nodes.map((n) => renderNode(n, 0))}
                {employees.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <p className="text-sm font-semibold">Unassigned</p>
                      <p className="text-xs text-muted-foreground">{employees.length} employee{employees.length !== 1 ? 's' : ''}</p>
                    </div>
                    {employees.map((m) => (
                      <Link
                        key={m.id}
                        href={`/employees/${m.id}/personal`}
                        className="ml-6 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 transition-colors hover:bg-accent/50"
                      >
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDot[m.employment_status] || 'bg-muted')} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{m.first_name} {m.last_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{m.compensation_grade || 'Member'}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}