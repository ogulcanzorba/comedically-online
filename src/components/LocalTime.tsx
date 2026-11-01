'use client';

import { useEffect, useState } from 'react';

/** Start time in the VIEWER's own time zone, with the zone name. */
export function LocalTime({
  utc,
  variant = 'short',
  className,
}: {
  utc: string;
  variant?: 'short' | 'full';
  className?: string;
}) {
  const [text, setText] = useState(utc);
  useEffect(() => {
    const opts: Intl.DateTimeFormatOptions =
      variant === 'full'
        ? {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
          }
        : { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    setText(new Intl.DateTimeFormat(undefined, opts).format(new Date(utc)));
  }, [utc, variant]);
  return (
    <time dateTime={utc} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
