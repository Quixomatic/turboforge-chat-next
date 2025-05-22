// components/turboforge-status.tsx
'use client';

import { LoaderIcon, SparklesIcon } from './icons';
import type { TurboForgeOperation } from '@/hooks/use-turboforge-patterns';

interface TurboForgeStatusProps {
  operation: TurboForgeOperation;
}

export function TurboForgeStatus({ operation }: TurboForgeStatusProps) {
  const getStatusColor = () => {
    switch (operation.status) {
      case 'failed':
        return 'text-red-500';
      case 'completed':
        return 'text-green-500';
      default:
        return 'text-blue-500';
    }
  };

  const getIcon = () => {
    if (operation.status === 'failed') {
      return <span className="text-red-500">⚠️</span>;
    }
    if (operation.status === 'completed') {
      return <span className="text-green-500">✅</span>;
    }
    return <div className="animate-spin"><LoaderIcon /></div>;
  };

  return (
    <div className="w-full mx-auto max-w-3xl px-4 group/message">
      <div className="flex gap-4 w-full">
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
          <div className="translate-y-px">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-row items-center gap-3">
            {getIcon()}
            <span className={`text-sm font-medium ${getStatusColor()}`}>
              {operation.type === 'research' ? 'Research Operation' : 'Implementation Operation'}
            </span>
          </div>
          
          <div className="text-sm text-muted-foreground">
            {operation.statusMessage}
          </div>

          {operation.status === 'polling' && (
            <div className="w-full bg-muted rounded-full h-1.5 mt-2">
              <div className="bg-blue-500 h-1.5 rounded-full animate-pulse w-1/3"></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}