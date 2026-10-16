import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";

import type { ChatMessage } from "../../types";
import { collectChatMedia, withChatMedia } from "./chatMediaGallery";

const environmentId = EnvironmentId.make("environment-1");
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const input = { environmentId, threadRef, cwd: "/repo" };

function message(id: string, text: string, attachments?: ChatMessage["attachments"]): ChatMessage {
  return {
    id: MessageId.make(id),
    role: "assistant",
    text,
    ...(attachments ? { attachments } : {}),
    runId: null,
    streaming: false,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("collectChatMedia", () => {
  it("lists attachments, embeds, media links, and bare media URLs in reading order, once each", () => {
    const media = collectChatMedia(
      [
        message("m1", "Here it is", [
          {
            type: "image",
            id: "a1",
            name: "shot.png",
            mimeType: "image/png",
            sizeBytes: 10,
            previewUrl: "/attachments/a1",
          },
        ]),
        message(
          "m2",
          [
            "![Hero](https://cdn.example.com/hero.jpg)",
            "The [tour video](https://cdn.example.com/tour.mp4) and [docs](https://example.com/docs).",
            "Raw link https://cdn.example.com/walkthrough.mov.",
            "Local ![diagram](docs/diagram.png)",
            "```md\n![ignored](https://cdn.example.com/in-code.png)\n```",
            "Again ![Hero](https://cdn.example.com/hero.jpg)",
          ].join("\n"),
        ),
      ],
      input,
    );

    expect(media.map((item) => [item.name, item.type ?? "image"])).toEqual([
      ["shot.png", "image"],
      ["Hero", "image"],
      ["tour video", "video"],
      ["walkthrough.mov", "video"],
      ["diagram", "image"],
    ]);
    expect(media[4]?.src).toBeNull();
    expect(media[4]?.actionsSource?.asset?.resource).toEqual({
      _tag: "media-file",
      threadId: threadRef.threadId,
      path: "/repo/docs/diagram.png",
    });
  });
});

describe("withChatMedia", () => {
  const chatMedia = collectChatMedia(
    [
      message(
        "m1",
        "![a](https://cdn.example.com/a.png) ![b](https://cdn.example.com/b.png) [v](https://cdn.example.com/v.mp4)",
      ),
    ],
    input,
  );

  it("opens the clicked media at its place in the whole chat, keeping its own item", () => {
    const clicked = {
      src: "https://cdn.example.com/v.mp4",
      name: "clicked",
      type: "video" as const,
    };
    const preview = withChatMedia({ images: [clicked], index: 0 }, chatMedia);
    expect(preview.index).toBe(2);
    expect(preview.images).toHaveLength(3);
    expect(preview.images[2]).toBe(clicked);
  });

  it("keeps media the chat does not list on its own", () => {
    const draft = { images: [{ src: "blob:draft", name: "draft.png" }], index: 0 };
    expect(withChatMedia(draft, chatMedia)).toBe(draft);
  });
});
