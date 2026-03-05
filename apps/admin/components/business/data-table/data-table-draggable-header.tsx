"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Header } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";

interface DraggableHeaderProps<TData> {
  header: Header<TData, unknown>;
}

export function DraggableHeader<TData>({
  header,
}: DraggableHeaderProps<TData>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: header.column.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={cn("h-10 group", isDragging && "bg-muted shadow-sm")}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="flex-none cursor-grab touch-none opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity -ml-1"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          {header.isPlaceholder
            ? null
            : flexRender(header.column.columnDef.header, header.getContext())}
        </div>
      </div>
    </TableHead>
  );
}
