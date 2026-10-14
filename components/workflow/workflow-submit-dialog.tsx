'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { WorkflowActorPicker } from '@/components/workflow/workflow-actor-picker';

export function WorkflowSubmitDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Submit for approval',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (authorizerId: string | null, approverId: string | null) => Promise<void> | void;
}) {
  const [authorizerId, setAuthorizerId] = useState<string | null>(null);
  const [approverId, setApproverId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setAuthorizerId(null); setApproverId(null); setBusy(false); }
  }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(authorizerId, approverId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="py-2">
          <WorkflowActorPicker
            authorizerId={authorizerId}
            approverId={approverId}
            onChange={(a, b) => { setAuthorizerId(a); setApproverId(b); }}
            disabled={busy}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? 'Submitting…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
