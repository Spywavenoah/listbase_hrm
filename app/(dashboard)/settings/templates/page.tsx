'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Mail } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface Template {
  id: string;
  event_key: string;
  subject: string;
  body_html: string;
  variables: string[];
  is_active: boolean;
}

const EVENT_KEYS = [
  'welcome.new_employee',
  'onboarding.checklist',
  'password.setup',
  'password.reset',
  'leave.approved',
  'leave.rejected',
  'payroll.payslip_ready',
  'exit.clearance',
  'invoice.receipt',
];

export default function MailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ event_key: '', subject: '', body_html: '', variables: [] as string[] });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('mail_templates')
        .select('*')
        .order('event_key');
      if (error) throw error;
      setTemplates((data || []) as unknown as Template[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ event_key: '', subject: '', body_html: '', variables: [] });
    setEditOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({ event_key: t.event_key, subject: t.subject, body_html: t.body_html, variables: t.variables || [] });
    setEditOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const { error } = await supabase
          .from('mail_templates')
          .update({ subject: form.subject, body_html: form.body_html, variables: form.variables })
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Template updated');
      } else {
        const { error } = await supabase
          .from('mail_templates')
          .insert({ event_key: form.event_key, subject: form.subject, body_html: form.body_html, variables: form.variables });
        if (error) throw error;
        toast.success('Template created');
      }
      setEditOpen(false);
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('mail_templates').delete().eq('id', id);
      if (error) throw error;
      toast.success('Template deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mail Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">Customize emails sent for system events</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Add Template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Mail className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">No templates configured yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{t.event_key}</p>
                    <p className="text-sm text-muted-foreground truncate">{t.subject}</p>
                  </div>
                  <Badge variant="outline" className={t.is_active ? 'bg-success/10 text-success' : ''}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Template' : 'New Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label>Event Key</Label>
              {editing ? (
                <Input value={form.event_key} disabled />
              ) : (
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.event_key}
                  onChange={(e) => setForm({ ...form, event_key: e.target.value })}
                >
                  <option value="">Select an event...</option>
                  {EVENT_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Body (HTML)</Label>
              <Textarea
                value={form.body_html}
                onChange={(e) => setForm({ ...form, body_html: e.target.value })}
                rows={10}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Use merge tags like {'{{employee_name}}'}, {'{{company_name}}'}, {'{{app_name}}'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.event_key || !form.subject}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
