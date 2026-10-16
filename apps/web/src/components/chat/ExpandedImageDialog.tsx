import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XIcon } from "lucide-react";
import { Image as ImageGlyph, Text as TextGlyph } from "lucide";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import {
  type ExpandedImageItem,
  type ExpandedImagePreview,
  expandedImageKey,
  wrapExpandedImageIndex,
} from "./ExpandedImagePreview";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import { useAssetUrlRefresh, useAssetUrlState } from "../../assets/assetUrls";
import { OpenMediaLink } from "../media/OpenMediaLink";
import { MediaActions, type MediaActionSource } from "../media/MediaActions";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { isContextMenuOpen } from "../../contextMenuFallback";
import {
  SnapShotAccessibilityData,
  SnapShotContentsButton,
  snapShotAccessibilityDetails,
} from "./SnapShotAttachmentDetails";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZoomableImage, type ZoomableImageHandle } from "./ZoomableImage";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

// Personal build: a full-window lightbox. A top bar names the media, the stage
// centers it between large arrows, and a film strip lists the rest of the
// gallery (the whole chat, when opened from the timeline).
// Viewport padding (48) + top bar (40) + film strip with its gap (~96).
const FILM_STRIP_RESERVED_HEIGHT = 200;
const TOP_BAR_RESERVED_HEIGHT = 110;

const EXPANDED_MEDIA_STATE_CLASS_NAME =
  "flex aspect-auto h-48 min-h-0 w-[min(var(--media-width),32rem)] flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-black p-6 text-center text-sm text-white shadow-2xl";

function ExpandedMediaFailure({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className={EXPANDED_MEDIA_STATE_CLASS_NAME}>
      {children}
    </div>
  );
}

/**
 * The loadable URL for an item. Media listed from the chat carries an asset
 * instead of a URL; it is signed only once something shows it.
 */
function useExpandedImageSrc(item: ExpandedImageItem | null) {
  const asset = item !== null && item.src === null ? item.actionsSource?.asset : undefined;
  const assetUrl = useAssetUrlState(asset?.environmentId ?? null, asset?.resource ?? null);
  if (item === null) return { src: null, failed: false };
  if (!asset) return { src: item.src, failed: item.src === null };
  return {
    src: assetUrl._tag === "Success" ? assetUrl.url + (item.srcFragment ?? "") : null,
    failed: assetUrl._tag === "Failure",
  };
}

function ExpandedVideo({ item }: { readonly item: ExpandedImageItem }) {
  const asset = item.actionsSource?.asset;
  const assetUrl = useAssetUrlState(asset?.environmentId ?? null, asset?.resource ?? null);
  const refreshAssetUrl = useAssetUrlRefresh(asset?.environmentId ?? null, asset?.resource ?? null);
  const src = asset
    ? assetUrl._tag === "Success"
      ? assetUrl.url + (item.srcFragment ?? "")
      : null
    : item.src;
  return (
    <MediaVideoPlayer
      src={src}
      label={item.name}
      sourceFailed={assetUrl._tag === "Failure"}
      originalUrl={item.originalUrl}
      preload="metadata"
      autoPlay={item.autoPlay ?? true}
      className="block max-h-[var(--media-height)] max-w-[var(--media-width)] text-center"
      videoClassName="aspect-auto max-h-[var(--media-height)] w-auto max-w-[var(--media-width)] rounded-lg shadow-2xl"
      stateClassName={EXPANDED_MEDIA_STATE_CLASS_NAME}
      onRetry={asset ? refreshAssetUrl : undefined}
    />
  );
}

function FilmStripThumb({
  item,
  index,
  active,
  onSelect,
}: {
  item: ExpandedImageItem;
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Off-screen thumbnails stay empty, so a long chat signs and loads only what the strip shows.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { root: element.parentElement, rootMargin: "0px 240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const isVideo = item.type === "video";
  const { src } = useExpandedImageSrc(visible && !isVideo ? item : null);
  return (
    <button
      ref={ref}
      type="button"
      data-index={index}
      aria-label={`${item.name} (${index + 1})`}
      aria-current={active || undefined}
      onClick={() => onSelect(index)}
      className={cn(
        "relative size-14 shrink-0 overflow-hidden rounded-md bg-white/8 outline-none transition-[opacity,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-white/70",
        active
          ? "opacity-100 ring-2 ring-white"
          : "opacity-45 hover:opacity-85 ring-1 ring-white/10",
      )}
    >
      {isVideo ? (
        <span className="flex size-full items-center justify-center text-white/80">
          <PlayIcon className="size-5 fill-current" aria-hidden="true" />
        </span>
      ) : src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      ) : null}
    </button>
  );
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const imageCount = preview.images.length;
  const [index, setIndex] = useState(() => wrapExpandedImageIndex(preview.index, imageCount));
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [accessibilityDetailsSrc, setAccessibilityDetailsSrc] = useState<string | null>(null);
  const zoomableImageRef = useRef<ZoomableImageHandle>(null);
  const filmStripRef = useRef<HTMLDivElement>(null);
  const [returnFocusTarget] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const item = preview.images[index] ?? null;
  const hasGallery = imageCount > 1;
  const image = useExpandedImageSrc(item?.type === "video" ? null : item);
  const source: MediaActionSource = item?.actionsSource ?? {
    kind: item?.type === "video" ? "video" : "image",
    name: item?.name ?? "Media",
    src: item?.src ?? null,
  };
  const openFile = source.onOpenFile;
  const actionsSource: MediaActionSource = {
    ...source,
    ...(source.src === null && image.src !== null ? { src: image.src } : {}),
    ...(openFile
      ? {
          onOpenFile: () => {
            openFile();
            onClose();
          },
        }
      : {}),
  };

  const navigateImage = (direction: -1 | 1) => {
    setIndex((current) => wrapExpandedImageIndex(current + direction, imageCount));
  };

  // Keeps the current thumbnail centered in the strip; the first placement is instant.
  const placedFilmStrip = useRef(false);
  useEffect(() => {
    const strip = filmStripRef.current;
    const thumb = strip?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!strip || !thumb) return;
    strip.scrollTo({
      left: thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2,
      behavior: placedFilmStrip.current ? "smooth" : "instant",
    });
    placedFilmStrip.current = true;
  }, [index]);

  // The element that opened the preview gets focus back on close. Without
  // this a close button click leaves focus on the unmounted dialog, and the
  // composer that owned the opener reads that as a blur and rests.
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isContextMenuOpen() || event.target instanceof HTMLVideoElement)
      return;
    if (zoomableImageRef.current?.pan(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!hasGallery) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(-1);
      return;
    }
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    navigateImage(1);
  };

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || isContextMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [onClose]);

  if (!item) return null;
  const mediaLabel = item.type === "video" ? "video" : "image";
  const openOriginalLink =
    item.originalUrl && resolveExternalWebLinkHost(item.originalUrl) !== null ? (
      <OpenMediaLink originalUrl={item.originalUrl} />
    ) : null;
  const accessibilityDetails = item.source ? snapShotAccessibilityDetails(item.source) : undefined;
  const showingAccessibilityDetails =
    Boolean(accessibilityDetails) && accessibilityDetailsSrc === item.src;
  const contentsLabel = showingAccessibilityDetails
    ? "Show screenshot"
    : accessibilityDetails?.format === "json"
      ? "Show accessibility JSON"
      : "Show extracted text";
  const closeOnBackdrop = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        {...composerFloatingLayerProps}
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className={cn(
          "row-start-1 h-full max-h-full w-full max-w-full items-stretch overflow-hidden [--media-width:92vw] sm:[--media-width:calc(92vw-96px)]",
          hasGallery
            ? "[--media-height:min(calc((100vh-var(--native-titlebar-height,0px))*0.86),calc(100vh-var(--native-titlebar-height,0px)-200px))]"
            : "[--media-height:min(calc((100vh-var(--native-titlebar-height,0px))*0.86),calc(100vh-var(--native-titlebar-height,0px)-110px))]",
        )}
        onKeyDown={onKeyDown}
        initialFocus={closeButtonRef}
        finalFocus={() => returnFocusTarget}
      >
        <DialogTitle className="sr-only">Expanded {mediaLabel} preview</DialogTitle>
        <div className="flex h-10 shrink-0 items-center gap-3 text-white" onClick={closeOnBackdrop}>
          {hasGallery ? (
            <span className="shrink-0 text-xs tabular-nums text-white/55">
              {index + 1} / {imageCount}
            </span>
          ) : null}
          <span
            className="min-w-0 truncate text-sm text-white/90"
            aria-live="polite"
            aria-atomic="true"
          >
            {item.name}
          </span>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            {accessibilityDetails && item.source ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={contentsLabel}
                      aria-pressed={showingAccessibilityDetails}
                      onClick={() =>
                        setAccessibilityDetailsSrc(showingAccessibilityDetails ? null : item.src)
                      }
                      size="icon-micro"
                      variant="overlay"
                    />
                  }
                >
                  <MorphIcon
                    className="size-3"
                    aria-hidden="true"
                    icon={showingAccessibilityDetails ? ImageGlyph : TextGlyph}
                  />
                </TooltipTrigger>
                <TooltipPopup side="bottom">{contentsLabel}</TooltipPopup>
              </Tooltip>
            ) : item.source ? (
              <SnapShotContentsButton source={item.source} side="bottom" />
            ) : null}
            <Button
              type="button"
              ref={closeButtonRef}
              size="icon-sm"
              variant="media-close"
              onClick={onClose}
              aria-label={`Close ${mediaLabel} preview`}
            >
              <XIcon />
            </Button>
          </div>
        </div>
        <div
          className="relative my-3 flex min-h-0 flex-1 items-center justify-center"
          onClick={closeOnBackdrop}
        >
          {hasGallery && (
            <Button
              type="button"
              size="icon-lg"
              variant="media-navigation"
              className="left-0"
              aria-label="Previous media"
              onClick={() => navigateImage(-1)}
            >
              <ChevronLeftIcon className="size-7" />
            </Button>
          )}
          <MediaActions source={actionsSource}>
            <div className="relative isolate z-10 max-w-[var(--media-width)]">
              {item.type === "video" ? (
                <ExpandedVideo key={index} item={item} />
              ) : showingAccessibilityDetails ? (
                accessibilityDetails ? (
                  <SnapShotAccessibilityData
                    details={accessibilityDetails}
                    className="h-[min(var(--media-height),40rem)] w-[min(var(--media-width),42rem)] transition-opacity duration-140 ease-out starting:opacity-0 rounded-lg border border-border/70 bg-background p-4 text-xs leading-5 shadow-2xl motion-reduce:transition-none"
                  />
                ) : null
              ) : image.failed || (image.src !== null && failedImageSrc === image.src) ? (
                <ExpandedMediaFailure>
                  <p>
                    {openOriginalLink
                      ? "This image could not be loaded."
                      : "Image unavailable. The file may have been moved or deleted."}
                  </p>
                  {openOriginalLink}
                </ExpandedMediaFailure>
              ) : image.src === null ? (
                <div role="status" className={EXPANDED_MEDIA_STATE_CLASS_NAME}>
                  Loading image…
                </div>
              ) : (
                <ZoomableImage
                  ref={zoomableImageRef}
                  key={`${index}:${image.src}`}
                  src={image.src}
                  name={item.name}
                  mimeType={item.mimeType}
                  reservedHeight={hasGallery ? FILM_STRIP_RESERVED_HEIGHT : TOP_BAR_RESERVED_HEIGHT}
                  onError={() => setFailedImageSrc(image.src)}
                />
              )}
            </div>
          </MediaActions>
          {hasGallery && (
            <Button
              type="button"
              size="icon-lg"
              variant="media-navigation"
              className="right-0"
              aria-label="Next media"
              onClick={() => navigateImage(1)}
            >
              <ChevronRightIcon className="size-7" />
            </Button>
          )}
        </div>
        {hasGallery && (
          <div
            ref={filmStripRef}
            role="group"
            aria-label="Media in this chat"
            className="relative mx-auto flex max-w-full shrink-0 gap-2 overflow-x-auto overscroll-contain p-1.5 [scrollbar-width:none]"
          >
            {preview.images.map((thumb, thumbIndex) => (
              <FilmStripThumb
                // oxlint-disable-next-line react/no-array-index-key -- the gallery is fixed while open
                key={thumbIndex}
                item={thumb}
                index={thumbIndex}
                active={thumbIndex === index}
                onSelect={setIndex}
              />
            ))}
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
});

/**
 * The chat view's open media preview. It lives outside ChatView so opening or
 * closing it renders only the dialog host, not the whole chat chrome.
 */
const expandedImagePreviewAtom = Atom.make<{
  readonly threadKey: string;
  readonly preview: ExpandedImagePreview;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("chat:expanded-image-preview"));

export function openExpandedImagePreview(threadKey: string, preview: ExpandedImagePreview): void {
  appAtomRegistry.set(expandedImagePreviewAtom, { threadKey, preview });
}

function closeExpandedImagePreview(): void {
  appAtomRegistry.set(expandedImagePreviewAtom, null);
}

function closeExpandedImagePreviewFor(threadKey: string): void {
  if (appAtomRegistry.get(expandedImagePreviewAtom)?.threadKey === threadKey) {
    closeExpandedImagePreview();
  }
}

export function ExpandedImageDialogHost({ threadKey }: { readonly threadKey: string }) {
  const state = useAtomValue(expandedImagePreviewAtom);
  const preview = state?.threadKey === threadKey ? state.preview : null;
  const item = preview?.images[preview.index];
  const ownedSrc = item?.ownsSrc === true ? item.src : null;
  useEffect(() => {
    if (ownedSrc === null) return;
    return () => URL.revokeObjectURL(ownedSrc);
  }, [ownedSrc]);
  // Leaving the thread (or the chat view) drops its preview.
  useEffect(() => () => closeExpandedImagePreviewFor(threadKey), [threadKey]);
  if (preview === null) return null;
  return (
    <ExpandedImageDialog
      key={expandedImageKey(preview)}
      preview={preview}
      onClose={closeExpandedImagePreview}
    />
  );
}
