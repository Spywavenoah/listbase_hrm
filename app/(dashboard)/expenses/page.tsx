'use client';

import ExpenseListPage from '@/components/expenses/expense-list-page';

export default function ExpensesPage() {
  return (
    <ExpenseListPage
      kind="CLAIM"
      title="Expense Claims"
      description="Submit and track expenses to be reimbursed"
      createLabel="New Expense Claim"
      emptyMessage="No expense claims yet"
      emptyDescription="Claims you submit (or claims awaiting your approval) will appear here."
    />
  );
}