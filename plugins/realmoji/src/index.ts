import { findByName, findByStoreName } from "@vendetta/metro";
import { after, before } from "@vendetta/patcher";
import { Embed, Message } from "vendetta-extras";

const patches = [];
const { getCustomEmojiById } = findByStoreName("EmojiStore");
const RowManager = findByName("RowManager");
// include optional query string so animated=true (or other params) are preserved
const emojiRegex = /https:\/\/cdn.discordapp.com\/emojis\/(\d+)\.\w+(?:\?[^\s]*)?/;

patches.push(
  before("generate", RowManager.prototype, ([data]) => {
    if (data.rowType !== 1) return;

    let content = data.message.content as string;
    if (!content?.length) return;
    const matchIndex = content.match(emojiRegex)?.index;
    if (matchIndex === undefined) return;
    const emojis = content.slice(matchIndex).trim().split("\n");
    if (!emojis.every((s) => s.match(emojiRegex))) return;
    content = content.slice(0, matchIndex);

    while (content.indexOf("  ") !== -1) content = content.replace("  ", ` ${emojis.shift()} `);

    content = content.trim();
    if (emojis.length) content += ` ${emojis.join(" ")}`;

    const embeds = data.message.embeds as Embed[];
    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
      if (embed.type === "image" && embed.url.match(emojiRegex)) embeds.splice(i--, 1);
    }

    data.message.content = content;
    data.__realmoji = true;
  }),
);

patches.push(
  after("generate", RowManager.prototype, ([data], row) => {
    if (data.rowType !== 1 || data.__realmoji !== true) return;
    const { content } = row.message as Message;
    if (!Array.isArray(content)) return;

    const jumbo = content.every(
      (c) =>
        (c.type === "link" && c.target.match(emojiRegex)) ||
        (c.type === "text" && c.content === " "),
    );

    for (let i = 0; i < content.length; i++) {
      const el = content[i];
      if (el.type !== "link") continue;

      const match = el.target.match(emojiRegex);
      if (!match) continue;

      // use the full matched URL (including any query params)
      const original = match[0];

      // build display URL: preserve existing query params and add size=128
      const displayUrl = original.includes("?") ? `${original}&size=128` : `${original}?size=128`;

      // build frozenSrc: force a non-animated webp and ensure animated=false (so .webp?animated=true becomes static)
      let frozenUrl;
      try {
        const u = new URL(original);
        // replace extension with webp
        const basePath = u.pathname.replace(/\.\w+$/, ".webp");
        const params = new URLSearchParams(u.search);
        // ensure it's not animated and has size
        params.set("animated", "false");
        params.set("size", "128");
        frozenUrl = `${u.origin}${basePath}?${params.toString()}`;
      } catch (e) {
        // fallback: naive transformations
        frozenUrl = original
          .replace(/\.\w+$/, ".webp")
          .replace(/([?&])animated=true(&|$)/, "$1animated=false$2");
        if (!/size=\d+/.test(frozenUrl))
          frozenUrl += (frozenUrl.includes("?") ? "&" : "?") + "size=128";
      }

      const emoji = getCustomEmojiById(match[1]);

      content[i] = {
        type: "customEmoji",
        id: match[1],
        alt: emoji?.name ?? "<realmoji>",
        src: displayUrl,
        frozenSrc: frozenUrl,
        jumboable: jumbo ? true : undefined,
      };
    }
  }),
);

export const onUnload = () => patches.forEach((unpatch) => unpatch());
