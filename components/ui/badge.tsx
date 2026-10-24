import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80 hover:shadow-lg hover:shadow-primary/30',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-sm',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80 hover:shadow-lg hover:shadow-destructive/30',
        outline: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        glow:
          'border-transparent bg-gradient-to-br from-primary via-primary/90 to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5',
        'glow-success':
          'border-transparent bg-gradient-to-br from-success via-success/90 to-success/80 text-success-foreground shadow-lg shadow-success/25 hover:shadow-success/40 hover:-translate-y-0.5',
        'glow-warning':
          'border-transparent bg-gradient-to-br from-warning via-warning/90 to-warning/80 text-warning-foreground shadow-lg shadow-warning/25 hover:shadow-warning/40 hover:-translate-y-0.5',
        'glow-destructive':
          'border-transparent bg-gradient-to-br from-destructive via-destructive/90 to-destructive/80 text-destructive-foreground shadow-lg shadow-destructive/25 hover:shadow-destructive/40 hover:-translate-y-0.5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
