import { useLayoutEffect, useRef } from 'react';

// The latest value for callbacks and animation loops, without re-subscribing on every render.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
