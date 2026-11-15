"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl, getSupabaseEnv } from "@/lib/supabase/env";
import { z } from "zod";

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function signIn(formData: FormData) {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/login", parsed.error.issues[0].message);
  if (!getSupabaseEnv()) fail("/login", "Supabase is not configured yet.");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data!);
  if (error) fail("/login", error.message);
  redirect("/");
}

export async function signUp(formData: FormData) {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/signup", parsed.error.issues[0].message);
  if (!getSupabaseEnv()) fail("/signup", "Supabase is not configured yet.");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data!,
    options: { emailRedirectTo: `${getAppUrl()}/auth/callback` },
  });
  if (error) fail("/signup", error.message);
  // With email confirmation on, there is no session yet.
  if (!data.session) redirect("/login?message=" + encodeURIComponent("Check your email to confirm your account, then sign in."));
  redirect("/");
}

export async function signInWithGoogle() {
  if (!getSupabaseEnv()) fail("/login", "Supabase is not configured yet.");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${getAppUrl()}/auth/callback` },
  });
  if (error || !data.url) fail("/login", error?.message ?? "Google sign-in is not enabled in Supabase yet.");
  redirect(data.url);
}

export async function requestPasswordReset(formData: FormData) {
  const email = z.string().trim().email().safeParse(formData.get("email"));
  if (!email.success) fail("/forgot-password", "Enter a valid email address.");
  if (!getSupabaseEnv()) fail("/forgot-password", "Supabase is not configured yet.");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data!, {
    redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password`,
  });
  if (error) fail("/forgot-password", error.message);
  redirect("/login?message=" + encodeURIComponent("If that email has an account, a reset link is on its way."));
}

export async function updatePassword(formData: FormData) {
  const password = z.string().min(8, "Password must be at least 8 characters.").safeParse(formData.get("password"));
  if (!password.success) fail("/reset-password", password.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data! });
  if (error) fail("/reset-password", error.message);
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
