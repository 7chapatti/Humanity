import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAdminEmail } from "@/lib/auth";
import { sendMagicLink } from "./actions";

export const metadata: Metadata = {
  title: "Sign in — Humanity AI",
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  invalid: "That is not an email address.",
  link: "That sign-in link has expired or was already used. Request a new one.",
};

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <LoginContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  if (await getAdminEmail()) redirect("/admin");

  const params = await searchParams;
  const sent = params.sent === "1";
  const errorKey = typeof params.error === "string" ? params.error : "";
  const error = ERRORS[errorKey];

  return (
    <>
      <header>
        <h1>Humanity AI</h1>
      </header>
      <main>
        <section aria-labelledby="signin-heading">
          <h2 id="signin-heading">Sign in</h2>
          {sent ? (
            <p className="notice" role="status">
              If that address is allowed in, a sign-in link is on its way. It expires after one hour.
            </p>
          ) : (
            <form action={sendMagicLink}>
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
              <button type="submit">Send sign-in link</button>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    </>
  );
}
