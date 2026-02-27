"use client";

import * as React from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { fadeSlideUp } from "@/lib/motion";
import { PageHeader } from "@/components/business/page-header";
import { Banner } from "@/components/ui/banner";
import {
  DetailActionBar,
  type DetailActionBarProps,
} from "@/components/business/detail-action-bar";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface DetailPageLayoutProps {
  /** Back navigation href */
  backHref: string;
  /** Page title */
  title: string;
  /** Optional description below title */
  description?: string;
  /** Status badge (e.g. <StatusBadge status="posted" />) */
  badge?: React.ReactNode;
  /** Metadata line below the title (e.g. short ID + copy button) */
  meta?: React.ReactNode;
  /** Action bar configuration */
  actions?: DetailActionBarProps;
  /** Raw actions node (alternative to DetailActionBar config) */
  actionsNode?: React.ReactNode;
  /** Error message — shown as a danger Banner */
  error?: string;
  /** Max width class override (default: max-w-6xl) */
  maxWidth?: string;
  /** Disable enter animation */
  disableAnimation?: boolean;
  className?: string;
  children: React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function DetailPageLayout({
  backHref,
  title,
  description,
  badge,
  meta,
  actions,
  actionsNode,
  error,
  maxWidth = "max-w-6xl",
  disableAnimation = false,
  className,
  children,
}: DetailPageLayoutProps) {
  const actionSlot = actionsNode ?? (actions ? <DetailActionBar {...actions} /> : undefined);

  const content = (
    <div className={cn("mx-auto space-y-6 p-6", maxWidth, className)}>
      {/* Header */}
      <PageHeader
        title={title}
        description={description}
        backHref={backHref}
        badge={badge}
        actions={actionSlot}
      >
        {meta}
      </PageHeader>

      {/* Error banner */}
      {error && (
        <Banner
          variant="danger"
          title="Error"
          description={error}
        />
      )}

      {/* Content */}
      {children}
    </div>
  );

  if (disableAnimation) return content;

  return (
    <motion.div
      variants={fadeSlideUp}
      initial="hidden"
      animate="visible"
    >
      {content}
    </motion.div>
  );
}
