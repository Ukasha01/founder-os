import { updatePassword } from "../actions";
import { Notice, inputClass, buttonClass } from "../notice";

// Reached from the emailed recovery link (the callback route has already created a session).
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <Notice error={error} />
      <form action={updatePassword} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">New password (8+ characters)
          <input name="password" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
        </label>
        <button className={buttonClass}>Set new password</button>
      </form>
    </>
  );
}
