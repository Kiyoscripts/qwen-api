/* Outbound links that are the same everywhere they appear.
 *
 * The invite lived as a private constant inside the old login page, so the
 * footer had no way to show it and the port dropped it entirely. It is a
 * property of the service, not of one page. */

export const DISCORD_INVITE =
  process.env.NEXT_PUBLIC_DISCORD_INVITE?.trim() || "https://discord.gg/Wcw95ZR8KU";
