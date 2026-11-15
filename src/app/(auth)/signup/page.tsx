import Link from "next/link";
import { signUp } from "../actions";
import { Notice, inputClass, buttonClass } from "../notice";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <Notice error={error} />
      <form action={signUp} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">Email
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">Password (8+ characters)
          <input name="password" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
        </label>
        <button className={buttonClass}>Create account</button>
      </form>
      <p className="text-sm">Already have an account? <Link href="/login" className="underline">Sign in</Link></p>
    </>
  );
}
