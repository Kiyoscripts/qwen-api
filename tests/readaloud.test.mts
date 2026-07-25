// Markdown read verbatim is unlistenable — "hash hash Setup", "star star
// important", whole URLs spelled out. These pin what reaches the synthesiser.

import { speakableText } from "../app/chat/ReadAloud";

let pass = 0, fail = 0;
const check = (name: string, got: string, want: string) => {
  if (got === want) pass++;
  else { fail++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

check("headings lose their hashes", speakableText("## Setup\nRun it."), "Setup. Run it.");
check("bold and italic keep the words", speakableText("This is **very** _important_."), "This is very important.");
check("links read as their text, not the URL",
  speakableText("See [the docs](https://example.com/a/b?c=d) for more."), "See the docs for more.");
check("images announce themselves", speakableText("![a cat](https://x/y.png) is here"), "(image) is here");
check("inline code keeps the identifier", speakableText("Call `getUser()` first."), "Call getUser() first.");
check("fenced code is summarised, not recited",
  speakableText("Before\n```js\nconst a = 1;\nfor (;;) {}\n```\nAfter"), "Before (code block) After");
check("bullets become spoken sentences", speakableText("- one\n- two\n- three"), "one. two. three.");
check("numbered lists too", speakableText("1. first\n2. second"), "first. second.");
check("blockquote loses the caret", speakableText("> quoted line"), "quoted line");
check("horizontal rules vanish", speakableText("A\n\n---\n\nB"), "A. B");
check("table pipes become spaces", speakableText("| a | b |"), "a b");
check("paragraph breaks add a stop only when missing", speakableText("One\n\nTwo."), "One. Two.");
check("existing punctuation is not doubled", speakableText("One.\n\nTwo."), "One. Two.");
check("whitespace is collapsed", speakableText("a   \n\t b"), "a b");
check("plain prose is untouched", speakableText("Just a normal sentence."), "Just a normal sentence.");
check("empty in, empty out", speakableText("   \n  "), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
