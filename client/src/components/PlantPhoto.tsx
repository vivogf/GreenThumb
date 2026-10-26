import { useState } from 'react';
import { Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlantPhotoProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  testId?: string;
}

/** Plant photo, or a local placeholder when the plant has no photo or it fails to load. */
export function PlantPhoto({ src, alt, className, testId }: PlantPhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}
        data-testid={testId ? `${testId}-placeholder` : undefined}
      >
        <Sprout className="w-1/3 h-1/3 max-w-12 max-h-12 opacity-60" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      data-testid={testId}
      onError={() => setFailedSrc(src)}
    />
  );
}
