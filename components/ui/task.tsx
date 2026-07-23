import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import { ChevronDownIcon, SearchIcon } from 'lucide-react';

export type TaskItemFileProps = ComponentProps<'div'>;

export const TaskItemFile = ({
  children,
  className,
  ...props
}: TaskItemFileProps) => (
  <div
    className={cn(
      'text-xs inline-flex items-center gap-1 px-1.5 py-0.5 text-zinc-100 border border-zinc-700 bg-zinc-800 rounded-md',
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type TaskItemProps = ComponentProps<'div'>;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn('text-sm text-zinc-400', className)} {...props}>
    {children}
  </div>
);

export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({
  defaultOpen = true,
  className,
  ...props
}: TaskProps) => (
  <Collapsible
    defaultOpen={defaultOpen}
    className={cn(
      'transition-all duration-200 data-[state=closed]:opacity-90',
      className,
    )}
    {...props}
  />
);

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export const TaskTrigger = ({
  children,
  className,
  title,
  ...props
}: TaskTriggerProps) => (
  <CollapsibleTrigger asChild className={cn('group', className)} {...props}>
    {children ?? (
      <div className="flex items-center gap-2 text-zinc-400 cursor-pointer hover:text-zinc-100 transition-colors">
        <SearchIcon className="size-4" />
        <p className="text-sm">{title}</p>
        <ChevronDownIcon className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsibleTrigger>
);

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({
  children,
  className,
  ...props
}: TaskContentProps) => (
  <CollapsibleContent
    className={cn(
      'text-zinc-300 outline-none transition-all duration-200 data-[state=closed]:opacity-0 data-[state=open]:opacity-100',
      className,
    )}
    {...props}
  >
    <div className="border-l-2 border-zinc-700 pl-4 mt-4 space-y-2">
      {children}
    </div>
  </CollapsibleContent>
);
