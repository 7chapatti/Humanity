"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that shows progress and blocks repeat clicks while its
 * form's Server Action runs. Must sit inside the <form> it submits.
 */
export function SubmitButton({ idle, pending }: { idle: string; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button type="submit" disabled={isPending} aria-busy={isPending}>
      {isPending ? pending : idle}
    </button>
  );
}
