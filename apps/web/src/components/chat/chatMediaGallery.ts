// Personal build: the lightbox browses every image and video in the chat, not
// just the clicked message's. The timeline is virtualized, so the list comes
// from the thread's messages rather than the DOM.
import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { type ChatMessage, isFileAttachment, isImageAttachment } from "../../types";
import { resolveProtocolRelativeMediaUrl } from "../media/mediaContent";
import {
  buildAttachmentVideoPreview,
  type ExpandedImageItem,
  type ExpandedImagePreview,
} from "./ExpandedImagePreview";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";

const FENCED_CODE = /(```|~~~)[\s\S]*?(?:\1|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
// `![alt](src "title")` and `[label](href)` with optional angle brackets, or a bare URL.
const MEDIA_REFERENCE =
  /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\bhttps?:\/\/[^\s<>()"'`\]]+/g;

/** Identity used to find the clicked media in the chat and to drop repeats. */
export function expandedMediaKey(item: ExpandedImageItem): string {
  const asset = item.actionsSource?.asset;
  return asset ? `asset:${JSON.stringify(asset.resource)}` : `src:${item.src ?? ""}`;
}

function textMedia(
  text: string,
  input: { threadRef: ScopedThreadRef | null; cwd: string | undefined },
): ExpandedImageItem[] {
  const items: ExpandedImageItem[] = [];
  const add = (source: string, label: string, imageEmbed: boolean) => {
    const media = resolveMediaSource(source, {
      threadId: input.threadRef?.threadId,
      workspaceRoot: input.cwd,
      imageEmbed,
    });
    if (media === null || media.access === "unavailable") return;
    const name = label.trim() || media.name;
    const video = media.kind === "video" ? ({ type: "video", autoPlay: false } as const) : {};
    if (media.access === "direct") {
      const src = resolveProtocolRelativeMediaUrl(media.uri);
      items.push({
        src,
        name,
        ...video,
        ...(resolveExternalWebLinkHost(media.uri) !== null ? { originalUrl: media.uri } : {}),
        actionsSource: {
          kind: media.kind,
          name,
          src,
          ...(media.reference ? { reference: media.reference } : {}),
        },
      });
      return;
    }
    if (!input.threadRef) return;
    items.push({
      src: null,
      name,
      ...video,
      ...(media.srcFragment ? { srcFragment: media.srcFragment } : {}),
      actionsSource: {
        kind: media.kind,
        name,
        src: null,
        asset: { environmentId: input.threadRef.environmentId, resource: media.resource },
        ...(media.reference ? { reference: media.reference } : {}),
      },
    });
  };

  const prose = text.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
  for (const [match, bang, label, destination] of prose.matchAll(MEDIA_REFERENCE)) {
    if (destination === undefined) add(match.replace(/[.,;:!?]+$/, ""), "", false);
    else add(destination, label ?? "", bang === "!");
  }
  return items;
}

/** Every image and video in the chat, in reading order, each listed once. */
export function collectChatMedia(
  messages: ReadonlyArray<ChatMessage>,
  input: {
    environmentId: EnvironmentId | null;
    threadRef: ScopedThreadRef | null;
    cwd: string | undefined;
  },
): ExpandedImageItem[] {
  const items: ExpandedImageItem[] = [];
  const seen = new Set<string>();
  const push = (item: ExpandedImageItem) => {
    const key = expandedMediaKey(item);
    if (key === "src:" || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (isImageAttachment(attachment)) {
        if (!attachment.previewUrl) continue;
        push({
          src: attachment.previewUrl,
          name: attachment.name,
          ...(attachment.source?.kind === "snap-shot" ? { source: attachment.source } : {}),
        });
      } else if (isFileAttachment(attachment) && input.environmentId) {
        const video = buildAttachmentVideoPreview(input.environmentId, attachment)?.images[0];
        if (video) push({ ...video, autoPlay: false });
      }
    }
    for (const item of textMedia(message.text, input)) push(item);
  }
  return items;
}

/**
 * Opens the clicked media inside the whole chat's media. The clicked item
 * keeps its own resolved URL and actions; media the chat does not list (a
 * draft attachment, a link resolved differently) opens on its own as before.
 */
export function withChatMedia(
  preview: ExpandedImagePreview,
  chatMedia: ReadonlyArray<ExpandedImageItem>,
): ExpandedImagePreview {
  const selected = preview.images[preview.index];
  if (!selected || chatMedia.length < 2) return preview;
  const key = expandedMediaKey(selected);
  const index = chatMedia.findIndex((item) => expandedMediaKey(item) === key);
  if (index < 0) return preview;
  const images = chatMedia.slice();
  images[index] = selected;
  return { images, index };
}
