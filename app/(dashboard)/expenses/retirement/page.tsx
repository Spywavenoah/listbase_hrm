'use client';

import ExpenseListPage from '@/components/expenses/expense-list-page';

export default function ExpenseRetirementPage() {
  return (
    <ExpenseListPage
      kind="RETIREMENT"
      title="Expense Retirements"
      description="Retire impress advances with proof of spending"
      createLabel="New Retirement"
      emptyMessage="No retirements yet"
      emptyDescription="Retirement statements you submit (or ones awaiting your approval) will appear here."
    />
  );
}