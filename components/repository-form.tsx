"use client";

import { useActionState, useId } from "react";
import { submitRepository } from "@/app/(app)/actions";

export function RepositoryForm() {
  const [state, action, pending] = useActionState(submitRepository, { error: null });
  const id = useId();
  return (
    <form action={action} className="shrink-0 border-b border-line px-4 py-3">
      <label htmlFor={id} className="mb-1 block text-muted">Public GitHub repository</label>
      <div className="flex max-w-2xl gap-2">
        <input id={id} name="repository" type="url" required maxLength={2048}
          placeholder="https://github.com/owner/repository" autoComplete="url" spellCheck={false}
          aria-describedby={state.error ? `${id}-error` : undefined} aria-invalid={Boolean(state.error)}
          className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 font-mono outline-accent" />
        <button type="submit" disabled={pending}
          className="h-8 rounded-sm border border-line px-3 text-accent disabled:cursor-wait disabled:text-muted">
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      {state.error && <p id={`${id}-error`} role="alert" className="mt-2 text-danger">{state.error}</p>}
    </form>
  );
}
