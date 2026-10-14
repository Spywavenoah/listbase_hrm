'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DynamicForm } from '@/components/field-engine/dynamic-form';
import { supabase } from '@/lib/supabase/client';
import { useAccess } from '@/lib/access';
import { isProfileLocked } from '@/lib/profile-lock';
import { ProfileLockBanner } from '@/components/profile-lock-banner';

const EMPTY = {
  guarantor_name: '',
  guarantor_relationship: '',
  guarantor_phone: '',
  guarantor_email: '',
  guarantor_address: '',
  guarantor_occupation: '',
  guarantor_employer: '',
};

export default function GuarantorPage() {
  const params = useParams();
  const id = params.id as string;
  const { employeeId: myId, can } = useAccess();
  const canWrite = can('employees.manage');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('employees')
        .select('employment_status')
        .eq('id', id)
        .maybeSingle();
      setStatus(data?.employment_status ?? null);
    })().catch(() => setStatus(null));
  }, [id]);

  const locked = isProfileLocked(myId, id, status, canWrite);

  const fetchSystemValues = useCallback(async (): Promise<Record<string, unknown>> => {
    const { data, error } = await supabase
      .from('employee_guarantors')
      .select('name, relationship, phone, email, address, occupation, employer')
      .eq('employee_id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ...EMPTY };
    return {
      guarantor_name: data.name || '',
      guarantor_relationship: data.relationship || '',
      guarantor_phone: data.phone || '',
      guarantor_email: data.email || '',
      guarantor_address: data.address || '',
      guarantor_occupation: data.occupation || '',
      guarantor_employer: data.employer || '',
    };
  }, [id]);

  const saveSystemValues = useCallback(
    async (sys: Record<string, unknown>) => {
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const payload = {
        employee_id: id,
        name: str(sys.guarantor_name),
        relationship: str(sys.guarantor_relationship),
        phone: str(sys.guarantor_phone),
        email: str(sys.guarantor_email),
        address: str(sys.guarantor_address),
        occupation: str(sys.guarantor_occupation),
        employer: str(sys.guarantor_employer),
      };

      const existing = await supabase
        .from('employee_guarantors')
        .select('id')
        .eq('employee_id', id)
        .maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data) {
        const res = await supabase
          .from('employee_guarantors')
          .update(payload)
          .eq('id', existing.data.id)
          .select('id');
        if (res.error) throw res.error;
        if ((res.data || []).length === 0) {
          throw new Error('Not authorized to update this guarantor record');
        }
      } else {
        const res = await supabase.from('employee_guarantors').insert(payload).select('id');
        if (res.error) throw res.error;
      }
    },
    [id]
  );

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-lg">Guarantor Information</CardTitle>
      </CardHeader>
      <CardContent>
        {locked && <ProfileLockBanner />}
        <DynamicForm
          moduleKey="employee_guarantor"
          recordId={id}
          readOnly={locked}
          systemFieldDefs={[
            { key: 'guarantor_name', label: 'Guarantor Full Name', type: 'text', required: true, section: 'Guarantor Details' },
            { key: 'guarantor_relationship', label: 'Relationship to Employee', type: 'text', section: 'Guarantor Details' },
            { key: 'guarantor_phone', label: 'Phone Number', type: 'text', required: true, section: 'Guarantor Details' },
            { key: 'guarantor_email', label: 'Email Address', type: 'text', section: 'Guarantor Details' },
            { key: 'guarantor_address', label: 'Home Address', type: 'text', section: 'Guarantor Details' },
            { key: 'guarantor_occupation', label: 'Occupation', type: 'text', section: 'Guarantor Details' },
            { key: 'guarantor_employer', label: 'Employer Name', type: 'text', section: 'Guarantor Details' },
          ]}
          fetchSystemValues={fetchSystemValues}
          onSubmitSystem={saveSystemValues}
          submitLabel="Save Guarantor Info"
        />
      </CardContent>
    </Card>
  );
}
