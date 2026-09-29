'use client';

import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Wrench, Plus, X, Download, Table as TableIcon, FileText, Link2, Filter, Trash2, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { AccessGate } from '@/lib/access';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  modules, type ModuleDef, type SelectedColumn, type FilterDef, type FilterOperator,
  buildSelectString, flattenRow,
} from '@/lib/report-builder/modules';
import { exportToPDF, fetchCompanyInfo, type CompanyInfo } from '@/lib/report-builder/pdf-export';

const operatorLabels: Record<FilterOperator, string> = {
  eq: 'equals',
  neq: 'not equals',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
  like: 'contains',
  ilike: 'contains (case-insensitive)',
};

export default function ReportBuilderPage() {
  const [selectedModule, setSelectedModule] = useState('');
  const [activeRelations, setActiveRelations] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>([]);
  const [filters, setFilters] = useState<FilterDef[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const primaryModule = modules.find((m) => m.key === selectedModule);

  const allAvailableFields = useMemo(() => {
    if (!primaryModule) return [];
    const fields: { path: string; label: string; isRelation: boolean; relationKey?: string; fieldKey: string }[] = [];
    for (const f of primaryModule.fields) {
      fields.push({ path: f.key, label: f.label, isRelation: false, fieldKey: f.key });
    }
    for (const rel of primaryModule.relations) {
      for (const f of rel.foreignFields) {
        fields.push({
          path: `${rel.key}.${f.key}`,
          label: `${rel.label} > ${f.label}`,
          isRelation: true,
          relationKey: rel.key,
          fieldKey: f.key,
        });
      }
    }
    return fields;
  }, [primaryModule]);

  const addColumn = (path: string) => {
    const field = allAvailableFields.find((f) => f.path === path);
    if (!field || selectedColumns.some((c) => c.path === path)) return;
    const newCol: SelectedColumn = {
      path: field.path,
      label: field.label,
      isRelation: field.isRelation,
      relationKey: field.relationKey,
      fieldKey: field.fieldKey,
    };
    setSelectedColumns([...selectedColumns, newCol]);
    if (field.isRelation && field.relationKey && !activeRelations.includes(field.relationKey)) {
      setActiveRelations([...activeRelations, field.relationKey!]);
    }
  };

  const removeColumn = (path: string) => {
    const col = selectedColumns.find((c) => c.path === path);
    setSelectedColumns(selectedColumns.filter((c) => c.path !== path));
    if (col?.relationKey) {
      const stillUsed = selectedColumns.some((c) => c.relationKey === col.relationKey && c.path !== path);
      if (!stillUsed) {
        setActiveRelations(activeRelations.filter((r) => r !== col.relationKey));
      }
    }
  };

  const addFilter = () => {
    if (allAvailableFields.length === 0) return;
    const firstField = allAvailableFields[0];
    setFilters([
      ...filters,
      {
        id: crypto.randomUUID(),
        fieldPath: firstField.path,
        fieldLabel: firstField.label,
        operator: 'eq',
        value: '',
      },
    ]);
  };

  const updateFilter = (id: string, updates: Partial<FilterDef>) => {
    setFilters(filters.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeFilter = (id: string) => {
    setFilters(filters.filter((f) => f.id !== id));
  };

  const runReport = useCallback(async () => {
    if (!primaryModule || selectedColumns.length === 0) {
      toast.error('Select a module and at least one column');
      return;
    }
    setLoading(true);
    try {
      const selectStr = buildSelectString(primaryModule, activeRelations, selectedColumns);
      let query = supabase.from(primaryModule.table).select(selectStr).limit(500);

      for (const filter of filters) {
        if (!filter.value) continue;
        const col = selectedColumns.find((c) => c.path === filter.fieldPath) ||
          allAvailableFields.find((f) => f.path === filter.fieldPath) as unknown as SelectedColumn;
        if (!col) continue;

        let queryField: string;
        if (col.isRelation && col.relationKey) {
          queryField = `${col.relationKey}.${col.fieldKey}`;
        } else {
          queryField = col.fieldKey;
        }

        const op = filter.operator;
        if (op === 'eq') query = query.eq(queryField, filter.value);
        else if (op === 'neq') query = query.neq(queryField, filter.value);
        else if (op === 'gt') query = query.gt(queryField, filter.value);
        else if (op === 'gte') query = query.gte(queryField, filter.value);
        else if (op === 'lt') query = query.lt(queryField, filter.value);
        else if (op === 'lte') query = query.lte(queryField, filter.value);
        else if (op === 'like') query = query.like(queryField, `%${filter.value}%`);
        else if (op === 'ilike') query = query.ilike(queryField, `%${filter.value}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const flatRows = ((data || []) as unknown as Record<string, unknown>[]).map((row) =>
        flattenRow(row, selectedColumns)
      );
      setRows(flatRows);
      setHasRun(true);
      toast.success(`${flatRows.length} records loaded`);
    } catch (err) {
      toast.error('Failed to load: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [primaryModule, selectedColumns, activeRelations, filters, allAvailableFields]);

  const handleExportCSV = () => {
    if (rows.length === 0) {
      toast.error('Run the report first to load data');
      return;
    }
    const colLabels = selectedColumns.map((c) => c.label);
    const csvLines: string[] = [colLabels.join(',')];
    for (const row of rows) {
      const vals = selectedColumns.map((col) => {
        const val = row[col.path];
        if (val === null || val === undefined) return '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
      });
      csvLines.push(vals.join(','));
    }
    const csv = csvLines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${primaryModule?.label || 'report'}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported as CSV');
  };

  const handleExportPDF = async () => {
    if (rows.length === 0) {
      toast.error('Run the report first to load data');
      return;
    }
    setExportingPDF(true);
    try {
      const companyInfo = await fetchCompanyInfo();
      const reportTitle = `${primaryModule?.label || 'Report'} Report`;
      const columns = selectedColumns.map((c) => ({ label: c.label, path: c.path }));
      await exportToPDF(columns, rows, reportTitle, companyInfo);
      toast.success('Report exported as PDF');
    } catch (err) {
      toast.error('Failed to export PDF: ' + (err as Error).message);
    } finally {
      setExportingPDF(false);
    }
  };

  const handleModuleChange = (v: string) => {
    setSelectedModule(v);
    setActiveRelations([]);
    setSelectedColumns([]);
    setFilters([]);
    setRows([]);
    setHasRun(false);
  };

  return (
    <AccessGate anyPrivilege={['admin.reports', 'admin.reports_write']}>
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Report Builder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build custom reports by combining data across modules, apply filters, and export to CSV or PDF
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Configuration */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Wrench className="h-4 w-4" /> Configuration</CardTitle>
              <CardDescription>Select a data source and fields</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Primary Module</Label>
                <Select value={selectedModule} onValueChange={handleModuleChange}>
                  <SelectTrigger><SelectValue placeholder="Choose a module" /></SelectTrigger>
                  <SelectContent>
                    {modules.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {primaryModule && allAvailableFields.length > 0 && (
                <div className="space-y-2">
                  <Label>Available Fields</Label>
                  <div className="space-y-1 max-h-72 overflow-y-auto rounded-lg border border-border p-2">
                    {primaryModule.fields.map((field) => (
                      <button
                        key={field.key}
                        onClick={() => addColumn(field.key)}
                        disabled={selectedColumns.some((c) => c.path === field.key)}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3 shrink-0" />
                        {field.label}
                      </button>
                    ))}
                    {primaryModule.relations.map((rel) => (
                      <div key={rel.key} className="pt-1">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                          <Link2 className="h-3 w-3" />
                          {rel.label}
                        </div>
                        {rel.foreignFields.map((field) => (
                          <button
                            key={`${rel.key}.${field.key}`}
                            onClick={() => addColumn(`${rel.key}.${field.key}`)}
                            disabled={selectedColumns.some((c) => c.path === `${rel.key}.${field.key}`)}
                            className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
                          >
                            <Plus className="h-3 w-3 shrink-0" />
                            {field.label}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Filters */}
          {primaryModule && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle>
                <CardDescription>Filter records by any field</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {filters.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">No filters applied. Add one to narrow results.</p>
                )}
                {filters.map((filter) => (
                  <div key={filter.id} className="space-y-1.5 rounded-lg border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <Select
                        value={filter.fieldPath}
                        onValueChange={(v) => {
                          const field = allAvailableFields.find((f) => f.path === v);
                          updateFilter(filter.id, { fieldPath: v, fieldLabel: field?.label || v });
                        }}
                      >
                        <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {allAvailableFields.map((f) => (
                            <SelectItem key={f.path} value={f.path}>{f.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        onClick={() => removeFilter(filter.id)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Select
                      value={filter.operator}
                      onValueChange={(v) => updateFilter(filter.id, { operator: v as FilterOperator })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(operatorLabels).map(([op, label]) => (
                          <SelectItem key={op} value={op}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={filter.value}
                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                      placeholder="Filter value"
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={addFilter} className="w-full">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Filter
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Preview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Selected Columns & Preview</CardTitle>
                <CardDescription>Add fields, run the report, then export</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={runReport} disabled={selectedColumns.length === 0 || loading}>
                  {loading ? 'Loading...' : 'Run Report'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportCSV} disabled={rows.length === 0}>
                  <Download className="mr-1.5 h-4 w-4" />
                  CSV
                </Button>
                <Button size="sm" onClick={handleExportPDF} disabled={rows.length === 0 || exportingPDF}>
                  {exportingPDF ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                      Exporting...
                    </span>
                  ) : (
                    <>
                      <FileText className="mr-1.5 h-4 w-4" />
                      PDF
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedColumns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <TableIcon className="h-10 w-10 opacity-40 mb-2" />
                <p className="text-sm">No columns selected yet.</p>
                <p className="text-xs mt-1">Pick a module on the left, then add fields to build your report.</p>
                <p className="text-xs mt-1 text-primary/70">Fields under a link icon come from a related module.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {selectedColumns.map((col) => (
                    <Badge key={col.path} variant="secondary" className="gap-1.5 pr-1.5">
                      {col.isRelation && <Link2 className="h-2.5 w-2.5 text-primary" />}
                      {col.label}
                      <button
                        onClick={() => { removeColumn(col.path); setRows([]); setHasRun(false); }}
                        className="rounded-full hover:bg-destructive/20 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>

                {activeRelations.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-primary">
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Joined with: {activeRelations.map((r) => primaryModule?.relations.find((rel) => rel.key === r)?.label || r).join(', ')}</span>
                  </div>
                )}

                {hasRun && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="overflow-x-auto max-h-96">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {selectedColumns.map((col) => (
                              <TableHead key={col.path} className="whitespace-nowrap">
                                {col.isRelation && <Link2 className="inline h-3 w-3 mr-1 text-primary" />}
                                {col.label}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={selectedColumns.length} className="h-16 text-center text-muted-foreground">
                                No data found
                              </TableCell>
                            </TableRow>
                          ) : (
                            rows.slice(0, 100).map((row, idx) => (
                              <TableRow key={idx}>
                                {selectedColumns.map((col) => (
                                  <TableCell key={col.path} className="text-sm whitespace-nowrap">
                                    {row[col.path] === null || row[col.path] === undefined ? '—' : String(row[col.path])}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {rows.length > 100 && (
                      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                        Showing first 100 of {rows.length} rows. Export to see all data.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </AccessGate>
  );
}
