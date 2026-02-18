/**
 * useVisibility - Track page visibility for pausing background operations.
 */

import { useEffect, useState } from 'react';

export function useVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    function handleVisibility() {
      setIsVisible(!document.hidden);
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return isVisible;
}
