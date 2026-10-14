import { Lock } from 'lucide-react';

export function ProfileLockBanner({ message }: { message?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3.5 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p className="text-muted-foreground">
        {message ||
          'This section is locked. Active employees can\u2019t edit their own records directly \u2014 contact HR to request changes.'}
      </p>
    </div>
  );
}