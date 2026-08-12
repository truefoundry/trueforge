import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';

export type StepIconBoxProps = {
  icon: string;
  iconSize?: string | number;
  variant?: 'primary' | 'muted';
  className?: string;
  iconClassName?: string;
};

export function StepIconBox({
  icon,
  iconSize = '0.75em',
  variant = 'primary',
  className,
  iconClassName,
}: StepIconBoxProps) {
  return (
    <div className={cn('flex size-5 shrink-0 items-center justify-center', className)}>
      <Icon
        name={icon}
        size={iconSize}
        className={cn(variant === 'primary' ? 'text-primary-button-bg' : 'text-text-secondary', iconClassName)}
      />
    </div>
  );
}
