export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'boolean';
}

export interface RelationDef {
  key: string;
  label: string;
  foreignTable: string;
  foreignKey: string;
  foreignFields: FieldDef[];
}

export interface ModuleDef {
  key: string;
  label: string;
  table: string;
  fields: FieldDef[];
  relations: RelationDef[];
}

const employeeFields: FieldDef[] = [
  { key: 'first_name', label: 'First Name', type: 'text' },
  { key: 'last_name', label: 'Last Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'employment_type', label: 'Employment Type', type: 'text' },
  { key: 'employment_status', label: 'Status', type: 'text' },
  { key: 'hire_date', label: 'Hire Date', type: 'date' },
  { key: 'department_id', label: 'Department ID', type: 'text' },
  { key: 'position_id', label: 'Position ID', type: 'text' },
  { key: 'compensation_grade', label: 'Compensation Grade', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'role', label: 'Role', type: 'text' },
];

const departmentFields: FieldDef[] = [
  { key: 'name', label: 'Department Name', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'cost_center', label: 'Cost Center', type: 'text' },
  { key: 'is_active', label: 'Active', type: 'boolean' },
];

const positionFields: FieldDef[] = [
  { key: 'title', label: 'Position Title', type: 'text' },
  { key: 'grade', label: 'Grade', type: 'text' },
  { key: 'employment_type', label: 'Employment Type', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'budgeted_salary_min', label: 'Salary Min', type: 'number' },
  { key: 'budgeted_salary_max', label: 'Salary Max', type: 'number' },
];

const trainingCourseFields: FieldDef[] = [
  { key: 'title', label: 'Course Title', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'duration_hours', label: 'Duration (hrs)', type: 'number' },
  { key: 'instructor', label: 'Instructor', type: 'text' },
  { key: 'is_mandatory', label: 'Mandatory', type: 'boolean' },
];

const payrollRunFields: FieldDef[] = [
  { key: 'name', label: 'Run Name', type: 'text' },
  { key: 'pay_period_start', label: 'Period Start', type: 'date' },
  { key: 'pay_period_end', label: 'Period End', type: 'date' },
  { key: 'total_gross', label: 'Gross', type: 'number' },
  { key: 'total_deductions', label: 'Deductions', type: 'number' },
  { key: 'total_net', label: 'Net', type: 'number' },
  { key: 'status', label: 'Status', type: 'text' },
];

const recruitmentJobFields: FieldDef[] = [
  { key: 'title', label: 'Job Title', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'posted_date', label: 'Posted Date', type: 'date' },
  { key: 'closing_date', label: 'Closing Date', type: 'date' },
];

export const modules: ModuleDef[] = [
  {
    key: 'employees',
    label: 'Employees',
    table: 'employees',
    fields: employeeFields,
    relations: [
      {
        key: 'department_id',
        label: 'Department',
        foreignTable: 'departments',
        foreignKey: 'department_id',
        foreignFields: departmentFields,
      },
      {
        key: 'position_id',
        label: 'Position',
        foreignTable: 'positions',
        foreignKey: 'position_id',
        foreignFields: positionFields,
      },
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    table: 'attendance',
    fields: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'clock_in', label: 'Clock In', type: 'text' },
      { key: 'clock_out', label: 'Clock Out', type: 'text' },
      { key: 'work_hours', label: 'Work Hours', type: 'number' },
      { key: 'overtime_hours', label: 'Overtime Hours', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    relations: [
      {
        key: 'employee_id',
        label: 'Employee',
        foreignTable: 'employees',
        foreignKey: 'employee_id',
        foreignFields: employeeFields,
      },
    ],
  },
  {
    key: 'leave_requests',
    label: 'Leave Requests',
    table: 'leave_requests',
    fields: [
      { key: 'start_date', label: 'Start Date', type: 'date' },
      { key: 'end_date', label: 'End Date', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'created_at', label: 'Created At', type: 'date' },
    ],
    relations: [
      {
        key: 'employee_id',
        label: 'Employee',
        foreignTable: 'employees',
        foreignKey: 'employee_id',
        foreignFields: employeeFields,
      },
    ],
  },
  {
    key: 'payroll_runs',
    label: 'Payroll Runs',
    table: 'payroll_runs',
    fields: payrollRunFields,
    relations: [],
  },
  {
    key: 'payslips',
    label: 'Payslips',
    table: 'payslips',
    fields: [
      { key: 'gross_pay', label: 'Gross Pay', type: 'number' },
      { key: 'total_deductions', label: 'Deductions', type: 'number' },
      { key: 'net_pay', label: 'Net Pay', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'generated_at', label: 'Generated At', type: 'date' },
    ],
    relations: [
      {
        key: 'employee_id',
        label: 'Employee',
        foreignTable: 'employees',
        foreignKey: 'employee_id',
        foreignFields: employeeFields,
      },
      {
        key: 'payroll_run_id',
        label: 'Payroll Run',
        foreignTable: 'payroll_runs',
        foreignKey: 'payroll_run_id',
        foreignFields: payrollRunFields,
      },
    ],
  },
  {
    key: 'assets',
    label: 'Assets',
    table: 'assets',
    fields: [
      { key: 'asset_tag', label: 'Asset Tag', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'asset_type', label: 'Type', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'serial_number', label: 'Serial Number', type: 'text' },
      { key: 'condition_status', label: 'Condition', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'purchase_date', label: 'Purchase Date', type: 'date' },
      { key: 'purchase_value', label: 'Purchase Value', type: 'number' },
      { key: 'current_value', label: 'Current Value', type: 'number' },
    ],
    relations: [
      {
        key: 'assigned_to',
        label: 'Assigned Employee',
        foreignTable: 'employees',
        foreignKey: 'assigned_to',
        foreignFields: employeeFields,
      },
    ],
  },
  {
    key: 'performance_reviews',
    label: 'Performance Reviews',
    table: 'performance_reviews',
    fields: [
      { key: 'review_cycle', label: 'Review Cycle', type: 'text' },
      { key: 'rating', label: 'Rating', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'feedback', label: 'Feedback', type: 'text' },
      { key: 'submitted_at', label: 'Submitted At', type: 'date' },
    ],
    relations: [
      {
        key: 'employee_id',
        label: 'Employee',
        foreignTable: 'employees',
        foreignKey: 'employee_id',
        foreignFields: employeeFields,
      },
    ],
  },
  {
    key: 'training_enrollments',
    label: 'Training Enrollments',
    table: 'training_enrollments',
    fields: [
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'progress', label: 'Progress', type: 'number' },
      { key: 'enrolled_at', label: 'Enrolled At', type: 'date' },
      { key: 'completed_at', label: 'Completed At', type: 'date' },
    ],
    relations: [
      {
        key: 'employee_id',
        label: 'Employee',
        foreignTable: 'employees',
        foreignKey: 'employee_id',
        foreignFields: employeeFields,
      },
      {
        key: 'course_id',
        label: 'Course',
        foreignTable: 'training_courses',
        foreignKey: 'course_id',
        foreignFields: trainingCourseFields,
      },
    ],
  },
  {
    key: 'recruitment_jobs',
    label: 'Recruitment Jobs',
    table: 'recruitment_jobs',
    fields: recruitmentJobFields,
    relations: [
      {
        key: 'department_id',
        label: 'Department',
        foreignTable: 'departments',
        foreignKey: 'department_id',
        foreignFields: departmentFields,
      },
      {
        key: 'position_id',
        label: 'Position',
        foreignTable: 'positions',
        foreignKey: 'position_id',
        foreignFields: positionFields,
      },
    ],
  },
  {
    key: 'candidates',
    label: 'Candidates',
    table: 'candidates',
    fields: [
      { key: 'first_name', label: 'First Name', type: 'text' },
      { key: 'last_name', label: 'Last Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'current_stage', label: 'Current Stage', type: 'text' },
      { key: 'rating', label: 'Rating', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
    relations: [
      {
        key: 'job_id',
        label: 'Job',
        foreignTable: 'recruitment_jobs',
        foreignKey: 'job_id',
        foreignFields: recruitmentJobFields,
      },
    ],
  },
];

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike';

export interface FilterDef {
  id: string;
  fieldPath: string;
  fieldLabel: string;
  operator: FilterOperator;
  value: string;
}

export interface SelectedColumn {
  path: string;
  label: string;
  isRelation: boolean;
  relationKey?: string;
  fieldKey: string;
}

export function buildSelectString(
  primaryModule: ModuleDef,
  activeRelations: string[],
  selectedColumns: SelectedColumn[]
): string {
  const parts: string[] = [];
  const relationFieldKeys = new Set<string>();

  for (const col of selectedColumns) {
    if (col.isRelation && col.relationKey) {
      if (!relationFieldKeys.has(col.relationKey)) {
        relationFieldKeys.add(col.relationKey);
        const relation = primaryModule.relations.find((r) => r.key === col.relationKey);
        if (relation) {
          const relFields = selectedColumns
            .filter((c) => c.relationKey === col.relationKey)
            .map((c) => c.fieldKey);
          parts.push(`${col.relationKey}(${relFields.join(',')})`);
        }
      }
    } else {
      parts.push(col.fieldKey);
    }
  }

  for (const relKey of activeRelations) {
    if (!relationFieldKeys.has(relKey)) {
      const relation = primaryModule.relations.find((r) => r.key === relKey);
      if (relation) {
        parts.push(`${relKey}(${relation.foreignFields.map((f) => f.key).join(',')})`);
      }
    }
  }

  return parts.join(',');
}

export function flattenRow(
  row: Record<string, unknown>,
  selectedColumns: SelectedColumn[]
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const col of selectedColumns) {
    if (col.isRelation && col.relationKey) {
      const nested = row[col.relationKey] as Record<string, unknown> | null;
      flat[col.path] = nested ? nested[col.fieldKey] : null;
    } else {
      flat[col.path] = row[col.fieldKey];
    }
  }
  return flat;
}
