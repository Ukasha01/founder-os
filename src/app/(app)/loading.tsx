// Shown instantly while the next screen loads, so a tap always gets an immediate response.
export default function Loading() {
  return (
    <div className="max-w-4xl animate-pulse" role="status" aria-label="Loading">
      <div className="h-8 w-56 rounded-xl bg-line" />
      <div className="mt-2 h-4 w-72 rounded-lg bg-line/70" />
      <div className="mt-6 grid grid-cols-3 gap-2.5"><div className="h-16 rounded-2xl bg-line/70" /><div className="h-16 rounded-2xl bg-line/70" /><div className="h-16 rounded-2xl bg-line/70" /></div>
      <div className="mt-4 flex flex-col gap-2.5"><div className="h-14 rounded-2xl bg-line/60" /><div className="h-14 rounded-2xl bg-line/60" /><div className="h-14 rounded-2xl bg-line/60" /></div>
    </div>
  );
}
