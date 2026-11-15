export function Notice({ error, message }: { error?: string; message?: string }) {
  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>;
  if (message) return <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{message}</p>;
  return null;
}

export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10";
export const buttonClass =
  "w-full rounded-md bg-neutral-900 px-3 py-2 text-base font-medium text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2";
