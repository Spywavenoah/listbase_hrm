export function isProfileLocked(
  currentEmployeeId: string | null,
  viewingId: string | undefined,
  employmentStatus: string | null | undefined,
  canWrite: boolean
): boolean {
  return (
    !!currentEmployeeId &&
    !!viewingId &&
    currentEmployeeId === viewingId &&
    employmentStatus === 'ACTIVE' &&
    !canWrite
  );
}