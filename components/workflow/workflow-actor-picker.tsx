'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { fetchWorkflowActorCandidates, type WorkflowActorCandidate } from '@/lib/workflow/engine';

const NONE = '__none__';

export function WorkflowActorPicker({
  authorizerId,
  approverId,
  onChange,
  disabled,
}: {
  authorizerId: string | null;
  approverId: string | null;
  onChange: (authorizerId: string | null, approverId: string | null) => void;
  disabled?: boolean;
}) {
  const [candidates, setCandidates] = useState<WorkflowActorCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await fetchWorkflowActorCandidates();
        if (active) setCandidates(rows);
      } catch {
        if (active) setCandidates([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const label = (c: WorkflowActorCandidate) =>
    `${c.name}${c.department_name ? ` · ${c.department_name}` : ''}`;

  const renderSelect = (
    value: string | null,
    onValue: (v: string | null) => void,
    placeholder: string
  ) => (
    <Select
      value={value || NONE}
      disabled={disabled || loading}
      onValueChange={(v) => onValue(v === NONE ? null : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder={loading ? 'Loading…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not specified</SelectItem>
        {candidates.map((c) => (
          <SelectItem key={c.id} value={c.id}>{label(c)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div>
        <p className="text-sm font-medium">Approval routing</p>
        <p className="text-xs text-muted-foreground">
          Choose who authorizes the first step and who gives final approval. Both must hold a role above Employee.
        </p>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading approvers…
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No eligible approvers found. Ask an admin to assign Manager / HR / Admin roles.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Authorizer (first step)</Label>
            {renderSelect(authorizerId, (v) => onChange(v, approverId), 'Select authorizer')}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Approver (final step)</Label>
            {renderSelect(approverId, (v) => onChange(authorizerId, v), 'Select approver')}
          </div>
        </div>
      )}
    </div>
  );
}
