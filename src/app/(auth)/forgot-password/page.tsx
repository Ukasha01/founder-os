import Link from "next/link";
import { requestPasswordReset } from "../actions";
import { Notice, inputClass, buttonClass } from "../notice";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <Notice error={error} />
      <form action={requestPasswordReset} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">Email
          <input name="email" type="email" autoComplete="email" required className={inputClass} />
        </label>
        <button className={buttonClass}>Send reset link</button>
      </form>
      <Link href="/login" className="text-sm underline">Back to sign in</Link>
    </>
  );
}
