'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  FileText, FileImage, File as FileIcon, Plus, Trash2, Upload,
  AlertCircle, Loader2, Eye,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

const BUCKET = 'employee-documents';
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB (matches bucket file_size_limit)
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

interface Doc {
  id: string;
  title: string;
  document_type: string | null;
  file_url: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  expiry_date: string | null;
  status: string;
  uploaded_at: string;
}

function formatBytes(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned || 'document';
}

export default function DocumentsPage() {
  const params = useParams();
  const id = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [newDoc, setNewDoc] = useState<{ title: string; document_type: string; expiry_date: string }>({
    title: '',
    document_type: '',
    expiry_date: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('employee_documents')
        .select('*')
        .eq('employee_id', id)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      setDocs((data || []) as unknown as Doc[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleFileChange = (selected: File | null) => {
    setFile(null);
    if (!selected) return;
    if (!ALLOWED_TYPES.includes(selected.type)) {
      toast.error('Only PDF, JPEG or PNG files are allowed.');
      return;
    }
    if (selected.size > MAX_SIZE) {
      toast.error('File is too large. Maximum size is 15 MB.');
      return;
    }
    setFile(selected);
  };

  const handleAdd = async () => {
    if (!file) {
      toast.error('Please choose a file to upload.');
      return;
    }
    setUploading(true);
    try {
      const docId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${id}/${docId}-${sanitizeFileName(file.name)}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error } = await supabase.from('employee_documents').insert({
        employee_id: id,
        title: newDoc.title,
        document_type: newDoc.document_type || null,
        file_path: path,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        expiry_date: newDoc.expiry_date || null,
      });
      if (error) throw error;

      toast.success('Document uploaded');
      setAddOpen(false);
      setNewDoc({ title: '', document_type: '', expiry_date: '' });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadDocs();
    } catch (err) {
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (doc: Doc) => {
    if (doc.file_path) {
      setViewingId(doc.id);
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(doc.file_path, 3600);
        if (error) throw error;
        if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
      } catch (err) {
        toast.error('Could not open file: ' + (err as Error).message);
      } finally {
        setViewingId(null);
      }
    } else if (doc.file_url) {
      window.open(doc.file_url, '_blank', 'noopener');
    }
  };

  const handleDelete = async (doc: Doc) => {
    try {
      const { error } = await supabase.from('employee_documents').delete().eq('id', doc.id);
      if (error) throw error;
      if (doc.file_path) {
        const { error: removeError } = await supabase.storage
          .from(BUCKET)
          .remove([doc.file_path]);
        if (removeError) console.warn('Storage cleanup failed:', removeError.message);
      }
      toast.success('Document deleted');
      loadDocs();
    } catch (err) {
      toast.error('Failed to delete: ' + (err as Error).message);
    }
  };

  const isExpiringSoon = (expiry: string | null) => {
    if (!expiry) return false;
    const days = (new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days < 30 && days > 0;
  };

  const isExpired = (expiry: string | null) => {
    if (!expiry) return false;
    return new Date(expiry) < new Date();
  };

  const docIcon = (doc: Doc) =>
    doc.file_type === 'application/pdf' ? <FileText className="h-5 w-5" /> : <FileImage className="h-5 w-5" />;

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Documents</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Document
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">No documents uploaded yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-4 rounded-lg border border-border p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {docIcon(doc)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{doc.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    {doc.document_type && (
                      <span className="text-xs text-muted-foreground">{doc.document_type}</span>
                    )}
                    {doc.file_name && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                        <FileIcon className="h-3 w-3" /> {doc.file_name} {doc.file_size && `(${formatBytes(doc.file_size)})`}
                      </span>
                    )}
                    {doc.expiry_date && isExpired(doc.expiry_date) && (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                        <AlertCircle className="mr-1 h-3 w-3" /> Expired
                      </Badge>
                    )}
                    {doc.expiry_date && isExpiringSoon(doc.expiry_date) && (
                      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">
                        <AlertCircle className="mr-1 h-3 w-3" /> Expiring Soon
                      </Badge>
                    )}
                  </div>
                </div>
                {(doc.file_path || doc.file_url) && (
                  <Button variant="outline" size="sm" onClick={() => handleView(doc)} disabled={viewingId === doc.id}>
                    {viewingId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                    View
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(doc)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setFile(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={newDoc.title} onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Document Type</Label>
              <Input value={newDoc.document_type} onChange={(e) => setNewDoc({ ...newDoc, document_type: e.target.value })} placeholder="e.g. Contract, ID Scan, Certificate" />
            </div>
            <div className="space-y-1.5">
              <Label>File (PDF, JPEG, PNG) *</Label>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  handleFileChange(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                  dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                }`}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                {file ? (
                  <span className="text-sm font-medium truncate max-w-[90%]">{file.name} ({formatBytes(file.size)})</span>
                ) : (
                  <span className="text-sm text-muted-foreground">Click to browse or drag & drop a file here</span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="text-xs text-muted-foreground">Supported: PDF, JPG, PNG — up to 15 MB.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Expiry Date</Label>
              <Input type="date" value={newDoc.expiry_date} onChange={(e) => setNewDoc({ ...newDoc, expiry_date: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={uploading}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!newDoc.title || !file || uploading}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}