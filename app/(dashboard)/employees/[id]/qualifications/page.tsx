'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DynamicForm } from '@/components/field-engine/dynamic-form';
import { supabase } from '@/lib/supabase/client';

const EMPTY = {
  highest_qualification: '',
  institution: '',
  graduation_year: '',
  field_of_study: '',
  grade_class: '',
};

export default function QualificationsPage() {
  const params = useParams();
  const id = params.id as string;

  const fetchSystemValues = useCallback(async (): Promise<Record<string, unknown>> => {
    const { data, error } = await supabase
      .from('employee_qualifications')
      .select('title, institution, year, field_of_study, grade_class')
      .eq('employee_id', id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ...EMPTY };
    return {
      highest_qualification: data.title || '',
      institution: data.institution || '',
      graduation_year: data.year ?? '',
      field_of_study: data.field_of_study || '',
      grade_class: data.grade_class || '',
    };
  }, [id]);

  const saveSystemValues = useCallback(
    async (sys: Record<string, unknown>) => {
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const year =
        typeof sys.graduation_year === 'number' && Number.isFinite(sys.graduation_year)
          ? sys.graduation_year
          : null;
      const payload = {
        employee_id: id,
        title: str(sys.highest_qualification),
        institution: str(sys.institution),
        year,
        field_of_study: str(sys.field_of_study),
        grade_class: str(sys.grade_class),
      };

      const existing = await supabase
        .from('employee_qualifications')
        .select('id')
        .eq('employee_id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data) {
        const res = await supabase
          .from('employee_qualifications')
          .update(payload)
          .eq('id', existing.data.id)
          .select('id');
        if (res.error) throw res.error;
        if ((res.data || []).length === 0) {
          throw new Error('Not authorized to update this qualification record');
        }
      } else {
        const res = await supabase.from('employee_qualifications').insert(payload).select('id');
        if (res.error) throw res.error;
      }
    },
    [id]
  );

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Qualifications & Education</CardTitle>
      </CardHeader>
      <CardContent>
        <DynamicForm
          moduleKey="employee_qualifications"
          recordId={id}
          systemFieldDefs={[
            { key: 'highest_qualification', label: 'Highest Qualification', type: 'text', section: 'Education' },
            { key: 'institution', label: 'Institution', type: 'text', section: 'Education' },
            { key: 'graduation_year', label: 'Graduation Year', type: 'number', section: 'Education' },
            { key: 'field_of_study', label: 'Field of Study', type: 'text', section: 'Education' },
            { key: 'grade_class', label: 'Grade/Class', type: 'text', section: 'Education' },
          ]}
          fetchSystemValues={fetchSystemValues}
          onSubmitSystem={saveSystemValues}
          submitLabel="Save Qualifications"
        />
      </CardContent>
    </Card>
  );
}
