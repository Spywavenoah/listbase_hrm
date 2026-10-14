'use client';

import ExpenseListPage from '@/components/expenses/expense-list-page';

export default function ExpenseRetirementPage() {
  return (
    <ExpenseListPage
      mode="retirement"
      title="Expense Retirement"
      description="Clear approved expense claims by recording the actual amount spent from the receipt"
      emptyMessage="Nothing to retire yet"
      emptyDescription="Approved claims awaiting clearance (and cleared claims) will appear here."
    />
  );
}
