"use client";

import { useMemo, useState } from "react";
import { Clock, PanelRightOpen, Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DocumentAttachments } from "@/components/document-attachments";
import { DocumentTimeline } from "@/components/document-timeline";

type TabKey = "attachments" | "timeline";

export function DocumentUtilitiesDrawer(props: {
  entityType: string;
  entityId: string;
  allowUploadAttachments?: boolean;
  showAttachments?: boolean;
  showTimeline?: boolean;
  className?: string;
}) {
  const canAttachments = props.showAttachments !== false;
  const canTimeline = props.showTimeline !== false;

  const defaultTab: TabKey = useMemo(() => {
    if (canAttachments) return "attachments";
    return "timeline";
  }, [canAttachments]);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>(defaultTab);

  if (!props.entityId || (!canAttachments && !canTimeline)) return null;

  function openTo(next: TabKey) {
    setTab(next);
    setOpen(true);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className={cn("flex items-center gap-2", props.className)}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-fg-muted"
          onClick={() => openTo(defaultTab)}
        >
          <PanelRightOpen className="h-4 w-4" />
          Utilities
        </Button>
      </div>

      <SheetContent side="right" className="overflow-hidden">
        <SheetHeader>
          <SheetTitle>Utilities</SheetTitle>
          <SheetDescription>Attachments and audit trail for this document. Kept out of the way until you need them.</SheetDescription>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canAttachments ? (
              <Button
                type="button"
                size="sm"
                variant={tab === "attachments" ? "secondary" : "ghost"}
                onClick={() => setTab("attachments")}
              >
                <Paperclip className="h-4 w-4 text-fg-muted" />
                Attachments
              </Button>
            ) : null}
            {canTimeline ? (
              <Button
                type="button"
                size="sm"
                variant={tab === "timeline" ? "secondary" : "ghost"}
                onClick={() => setTab("timeline")}
              >
                <Clock className="h-4 w-4 text-fg-muted" />
                Timeline
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        <SheetBody className="pt-0">
          {/* Lazy-mount to avoid fetching unless the drawer is opened. */}
          {open ? (
            tab === "attachments" ? (
              <DocumentAttachments
                entityType={props.entityType}
                entityId={props.entityId}
                allowUpload={Boolean(props.allowUploadAttachments)}
                variant="embedded"
              />
            ) : (
              <DocumentTimeline entityType={props.entityType} entityId={props.entityId} variant="embedded" />
            )
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
