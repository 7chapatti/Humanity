/**
 * Cheap, rule-based checks run on every draft. They never publish or delete
 * anything: they attach flags so the approval page can show what to look at.
 * Every post still needs a human approval before it goes anywhere.
 */

export type SafetyFlag =
  | "too_long"
  | "hashtag"
  | "emoji"
  | "exclamation"
  | "date_with_harm"
  | "harm_language"
  | "call_to_action";

const MAX_POST_LENGTH = 280;

const HARM_WORDS = [
  "attack",
  "bomb",
  "blast",
  "explosion",
  "shooting",
  "massacre",
  "kill",
  "killed",
  "die",
  "dies",
  "death",
  "dead",
  "assassinat",
  "terror",
  "disaster",
  "collapse",
  "crash",
  "riot",
  "invasion",
  "strike",
];

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const DATE_PATTERN = new RegExp(
  [
    `\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS})\\b`,
    `\\b(${MONTHS})\\s+\\d{1,2}(st|nd|rd|th)?\\b`,
    `\\b\\d{1,2}[/.-]\\d{1,2}([/.-]\\d{2,4})?\\b`,
    `\\bweek (commencing|of)\\b`,
    `\\b(next|this) (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b`,
  ].join("|"),
  "i",
);

const HARM_PATTERN = new RegExp(`\\b(${HARM_WORDS.join("|")})\\w*`, "i");
const CALL_TO_ACTION_PATTERN = /\b(you should|go (and )?(vote|buy|join)|click|sign up|follow us|share this)\b/i;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const HASHTAG_PATTERN = /(^|\s)#[\p{L}\p{N}_]+/u;

export function checkPost(content: string): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  if (content.length > MAX_POST_LENGTH) flags.push("too_long");
  if (HASHTAG_PATTERN.test(content)) flags.push("hashtag");
  if (EMOJI_PATTERN.test(content)) flags.push("emoji");
  if (content.includes("!")) flags.push("exclamation");
  const hasHarm = HARM_PATTERN.test(content);
  if (hasHarm && DATE_PATTERN.test(content)) flags.push("date_with_harm");
  else if (hasHarm) flags.push("harm_language");
  if (CALL_TO_ACTION_PATTERN.test(content)) flags.push("call_to_action");
  return flags;
}

export const FLAG_LABELS: Record<SafetyFlag, string> = {
  too_long: "Over 280 characters",
  hashtag: "Contains a hashtag",
  emoji: "Contains an emoji",
  exclamation: "Contains an exclamation mark",
  date_with_harm: "Date next to harm language — check it is not predicting violence",
  harm_language: "Harm language — check it is not mocking victims",
  call_to_action: "Reads like a call to action",
};
