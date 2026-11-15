import Link from "next/link";
import { signIn, signInWithGoogle } from "../actions";
import { Notice, inputClass, buttonClass } from "../notice";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  return (
    <>
      <Notice error={error} message={message} />
      <form action={signIn} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">Email
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">Password
          <input name="password" type="password" autoComplete="current-password" required minLength={8} className={inputClass} />
        </label>
        <button className={buttonClass}>Sign in</button>
      </form>
      <form action={signInWithGoogle}>
        <button className="w-full rounded-md border border-neutral-300 px-3 py-2 text-base hover:bg-neutral-50">
          Continue with Google
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="underline">Forgot password?</Link>
        <Link href="/signup" className="underline">Create account</Link>
      </div>
    </>
  );
}
