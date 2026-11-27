export function Notice({ error, message }: { error?: string; message?: string }) {
  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (message) return <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{message}</p>;
  return null;
}

export const inputClass =
  "w-full rounded-md border border-line-strong bg-field px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
export const buttonClass =
  "w-full rounded-md bg-accent px-3 py-2 text-base font-medium text-on-accent hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2";
