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
import { Plus, Pencil, Trash2, FileSignature, Eye, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { getBrandVariables } from '@/lib/letterhead/fetch';

interface Letterhead {
  id: string;
  name: string;
  body_html: string;
  variables: unknown;
  is_default: boolean;
  is_active: boolean;
}

function interpolate(html: string, vars: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v ?? '');
  }
  return out;
}

const SAMPLE_BRAND = {
  company_name: 'Example Systems Ltd',
  company_logo_url: 'https://dummyimage.com/160x40/0f172a/ffffff.png&text=LOGO',
  company_address: '10 Crest Avenue, Victoria Island, Lagos, Nigeria',
  company_phone: '+234 901 234 5678',
  company_email: 'info@example.com',
  company_website: 'www.example.com',
  tax_id: 'TIN-123456789',
  registration_number: 'RC-987654',
  app_name: 'HRM Flow',
  logo_url: '',
};

export default function LetterheadsPage() {
  const [items, setItems] = useState<Letterhead[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Letterhead | null>(null);
  const [form, setForm] = useState({ name: '', body_html: '', is_default: false, is_active: true });
  const [preview, setPreview] = useState<Letterhead | null>(null);
  const [brandVars, setBrandVars] = useState<Record<string, string>>(SAMPLE_BRAND);

  const load = useCallback(async () => {
    try {
      const [lh, bv] = await Promise.all([
        supabase
          .from('company_letterheads')
          .select('*')
          .order('is_default', { ascending: false })
          .order('name'),
        getBrandVariables().catch(() => SAMPLE_BRAND),
      ]);
      if (lh.error) throw lh.error;
      setItems((lh.data || []) as Letterhead[]);
      setBrandVars({ ...SAMPLE_BRAND, ...bv });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', body_html: '', is_default: false, is_active: true });
    setEditOpen(true);
  };
  const openEdit = (t: Letterhead) => {
    setEditing(t);
    setForm({ name: t.name, body_html: t.body_html, is_default: t.is_default, is_active: t.is_active });
    setEditOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const updates: any = { name: form.name, body_html: form.body_html, is_active: form.is_active };
        if (form.is_default) updates.is_default = true;
        const { error } = await supabase.from('company_letterheads').update(updates).eq('id', editing.id);
        if (error) throw error;
        if (form.is_default) {
          await supabase.from('company_letterheads').update({ is_default: false }).neq('id', editing.id);
        }
        toast.success('Letterhead updated');
      } else {
        const ins: any = { name: form.name, body_html: form.body_html, is_default: form.is_default, is_active: form.is_active };
        const { data, error } = await supabase.from('company_letterheads').insert(ins).select('id').single();
        if (error) throw error;
        if (form.is_default && data?.id) {
          await supabase.from('company_letterheads').update({ is_default: false }).neq('id', data.id);
        }
        toast.success('Letterhead created');
      }
      setEditOpen(false);
      load();
    } catch (err) {
      toast.error('Failed to save: ' + (err as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('company_letterheads').delete().eq('id', id);
      if (error) throw error;
      toast.success('Letterhead deleted');
      load();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await supabase.from('company_letterheads').update({ is_default: false });
      await supabase.from('company_letterheads').update({ is_default: true }).eq('id', id);
      toast.success('Set as default');
      load();
    } catch (err) {
      toast.error('Failed: ' + (err as Error).message);
    }
  };

  const previewHtml = (lh: Letterhead) => interpolate(lh.body_html, brandVars);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Letterheads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Design reusable company letterheads for print/PDF</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Add Letterhead
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileSignature className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">No letterheads configured yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((t) => (
                <div key={t.id} className="flex items-center gap-4 p-4 hover:bg-accent/30 transition-colors">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileSignature className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{t.name}</p>
                  </div>
                  {t.is_default && (
                    <Badge variant="outline" className="bg-success/10 text-success">
                      Default
                    </Badge>
                  )}
                  <Badge variant="outline" className={t.is_active ? '' : 'text-muted-foreground'}>
                    {t.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  {!t.is_default && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDefault(t.id)} title="Set as default">
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreview(t)} title="Preview">
                    <Eye className="h-4 w-4" />
                  </Button>
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Letterhead' : 'New Letterhead'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                Set as default
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>Body (HTML)</Label>
              <Textarea value={form.body_html} onChange={(e) => setForm({ ...form, body_html: e.target.value })} rows={10} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">
                Merge tags: {'{{company_name}}'}, {'{{company_logo_url}}'}, {'{{company_address}}'}, {'{{company_phone}}'}, {'{{company_email}}'}, {'{{company_website}}'}, {'{{tax_id}}'}, {'{{registration_number}}'}, {'{{app_name}}'}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Live Preview</Label>
              <div className="rounded-lg border bg-muted/20">
                <iframe
                  srcDoc={interpolate(form.body_html || '<div></div>', brandVars)}
                  sandbox="allow-same-origin"
                  className="h-56 w-full rounded-lg border-0"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.body_html.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview: {preview?.name}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border">
            <iframe
              srcDoc={preview ? previewHtml(preview) : '<div></div>'}
              sandbox=""
              className="h-[60vh] w-full rounded-lg border-0"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
