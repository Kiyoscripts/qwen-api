// Flattening a conversation into a single prompt.
//
// Qwen's endpoint does not accept an OpenAI-style role array: it answers
// "Invalid input too many messages" to anything but a single message, keeping
// real roles server-side in a chat tree addressed by parent message id — so
// passing history on a stateless request means writing it into that one message.
//
// The transcript this produces is read by the model as ordinary text, which is
// what makes the details below matter.

export type CollapseRole = "system" | "user" | "assistant";
export interface CollapseTurn {
  role: CollapseRole;
  text: string;
}

const LABELS: Record<CollapseRole, string> = {
  system: "[system]",
  user: "[user]",
  assistant: "[assistant]",
};

// A line that is exactly one of our labels — the only thing that can be mistaken
// for a turn boundary once the transcript is assembled.
const LABEL_LINE = /^[ \t]*\[[ \t]*(system|user|assistant)[ \t]*\][ \t]*$/i;

/**
 * Remove anything from message content that would read as a turn boundary.
 *
 * Without this, a user who types a line consisting of `[system]` can open what
 * looks like a system block in the flattened prompt and override instructions
 * the operator set. Boundaries are whole lines, so stripping whole lines closes
 * the seam completely rather than trying to escape it.
 */
export function stripTurnLabels(text: string): string {
  if (!text.includes("[")) return text; // cheap out for the overwhelming majority
  return text
    .split("\n")
    .filter((line) => !LABEL_LINE.test(line))
    .join("\n");
}

/**
 * Collapse a conversation into one prompt.
 *
 * A lone user message is passed through untouched — that is most traffic, and
 * wrapping it would only add noise. Anything with history or a system prompt
 * becomes a labelled transcript.
 *
 * Note there is no trailing "[assistant]" prime. Priming a chat model to
 * continue is what invites it to write *both* sides and invent the next user
 * turn; asked plainly, it simply answers.
 */
export function collapseConversation(turns: CollapseTurn[]): string {
  const clean = turns
    .map((t) => ({ role: t.role, text: stripTurnLabels(t.text).trim() }))
    .filter((t) => t.text.length > 0);

  const system = clean.filter((t) => t.role === "system");
  const dialogue = clean.filter((t) => t.role !== "system");

  if (system.length === 0 && dialogue.length <= 1) return dialogue[0]?.text ?? "";

  const blocks: string[] = [];
  // System instructions are hoisted into one labelled block at the top, so they
  // read as instructions rather than as something the user happened to say.
  if (system.length) blocks.push(`${LABELS.system}\n${system.map((t) => t.text).join("\n\n")}`);
  for (const t of dialogue) blocks.push(`${LABELS[t.role]}\n${t.text}`);
  return blocks.join("\n\n");
}
