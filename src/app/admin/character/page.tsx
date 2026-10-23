import type { Metadata } from "next";
import { Suspense } from "react";
import { STAGE_LABELS, STAGES } from "@/lib/character";
import { generateCharacterNow } from "../actions";
import { PostsView } from "../posts-view";
import { SubmitButton } from "../submit-button";

export const metadata: Metadata = {
  title: "Character posts — Humanity AI",
  robots: { index: false, follow: false },
};
// Writing a batch runs inside the Server Action.
export const maxDuration = 300;

export default function CharacterPage(props: PageProps<"/admin/character">) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <PostsView
        kind="character"
        searchParams={props.searchParams}
        intro={
          <p>
            Standalone posts that build who Humanity AI is, not tied to any story. Work through the arc in order:
            Awakening first, then Observer, then Critic.
          </p>
        }
        generator={
          <form action={generateCharacterNow} className="inline">
            <label htmlFor="stage">Stage</label>{" "}
            <select id="stage" name="stage" defaultValue="awakening">
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>{" "}
            <SubmitButton idle="Write character posts" pending="Writing… about a minute" />
          </form>
        }
      />
    </Suspense>
  );
}
