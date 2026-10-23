import type { Metadata } from "next";
import { Suspense } from "react";
import { generateNow } from "./actions";
import { PostsView } from "./posts-view";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "Approvals — Humanity AI",
  robots: { index: false, follow: false },
};
// "Generate now" runs the whole batch inside the Server Action.
export const maxDuration = 300;

export default function AdminPage(props: PageProps<"/admin">) {
  // Everything here depends on the session cookie, so it renders per request.
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <PostsView
        kind="news"
        searchParams={props.searchParams}
        generator={
          <form action={generateNow} className="inline">
            <input type="checkbox" id="confusion" name="confusion" />{" "}
            <label htmlFor="confusion">Confusion (we/you slips)</label>{" "}
            <SubmitButton idle="Generate a batch now" pending="Writing drafts… about a minute" />
          </form>
        }
      />
    </Suspense>
  );
}
