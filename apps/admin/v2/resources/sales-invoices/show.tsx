"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import {
  ArrayField,
  ChipField,
  Datagrid,
  DateField,
  EditButton,
  NumberField,
  Show,
  SimpleShowLayout,
  TabbedShowLayout,
  TextField,
  TopToolbar,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
} from "react-admin";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField as MuiTextField,
} from "@mui/material";

import { httpJson } from "@/v2/http";

function SalesInvoiceShowActions() {
  const record = useRecordContext<any>();
  const notify = useNotify();
  const refresh = useRefresh();
  const redirect = useRedirect();

  const [postOpen, setPostOpen] = useState(false);
  const [applyVat, setApplyVat] = useState(true);
  const [postBusy, setPostBusy] = useState(false);

  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelDraftReason, setCancelDraftReason] = useState("");
  const [cancelDraftBusy, setCancelDraftBusy] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelDate, setCancelDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const canEditDraft = record?.status === "draft";
  const canPost = record?.status === "draft";
  const canCancelDraft = record?.status === "draft";
  const canCancelPosted = record?.status === "posted";
  const postBlockedReason =
    canPost && !record?.customer_id
      ? "Credit posting requires a customer (payments UI is coming next)."
      : "";

  async function doPost() {
    if (!record?.id) return;
    setPostBusy(true);
    try {
      await httpJson(`/sales/invoices/${record.id}/post`, {
        method: "POST",
        body: JSON.stringify({ apply_vat: applyVat }),
      });
      notify("Invoice posted", { type: "success" });
      setPostOpen(false);
      refresh();
      redirect("show", "sales-invoices", record.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to post invoice", { type: "error" });
    } finally {
      setPostBusy(false);
    }
  }

  async function doCancelDraft() {
    if (!record?.id) return;
    setCancelDraftBusy(true);
    try {
      await httpJson(`/sales/invoices/${record.id}/cancel-draft`, {
        method: "POST",
        body: JSON.stringify({ reason: cancelDraftReason || null }),
      });
      notify("Draft canceled", { type: "success" });
      setCancelDraftOpen(false);
      refresh();
      redirect("show", "sales-invoices", record.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to cancel draft", { type: "error" });
    } finally {
      setCancelDraftBusy(false);
    }
  }

  async function doCancelPosted() {
    if (!record?.id) return;
    setCancelBusy(true);
    try {
      await httpJson(`/sales/invoices/${record.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancel_date: cancelDate || null, reason: cancelReason || null }),
      });
      notify("Invoice canceled", { type: "success" });
      setCancelOpen(false);
      refresh();
      redirect("show", "sales-invoices", record.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to cancel invoice", { type: "error" });
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <>
      <TopToolbar>
        {canEditDraft ? <EditButton /> : null}
        {canPost ? (
          <Button
            variant="contained"
            color="primary"
            onClick={() => setPostOpen(true)}
            disabled={Boolean(postBlockedReason)}
            title={postBlockedReason || undefined}
          >
            Post
          </Button>
        ) : null}
        {canCancelDraft ? (
          <Button variant="outlined" color="warning" onClick={() => setCancelDraftOpen(true)}>
            Cancel Draft
          </Button>
        ) : null}
        {canCancelPosted ? (
          <Button variant="outlined" color="warning" onClick={() => setCancelOpen(true)}>
            Void (Cancel)
          </Button>
        ) : null}
      </TopToolbar>

      <Dialog open={postOpen} onClose={() => setPostOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Post Sales Invoice</DialogTitle>
        <DialogContent>
          <FormControlLabel
            control={<Switch checked={applyVat} onChange={(e) => setApplyVat(e.target.checked)} />}
            label="Apply VAT (if configured)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPostOpen(false)} disabled={postBusy}>
            Close
          </Button>
          <Button onClick={doPost} disabled={postBusy} variant="contained">
            Post
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cancelDraftOpen} onClose={() => setCancelDraftOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Cancel Draft</DialogTitle>
        <DialogContent>
          <MuiTextField
            fullWidth
            label="Reason (optional)"
            value={cancelDraftReason}
            onChange={(e) => setCancelDraftReason(e.target.value)}
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDraftOpen(false)} disabled={cancelDraftBusy}>
            Close
          </Button>
          <Button onClick={doCancelDraft} disabled={cancelDraftBusy} variant="contained" color="warning">
            Cancel Draft
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Void Posted Invoice</DialogTitle>
        <DialogContent>
          <MuiTextField
            fullWidth
            type="date"
            label="Cancel date"
            value={cancelDate}
            onChange={(e) => setCancelDate(e.target.value)}
            margin="dense"
            InputLabelProps={{ shrink: true }}
          />
          <MuiTextField
            fullWidth
            label="Reason (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
            Close
          </Button>
          <Button onClick={doCancelPosted} disabled={cancelBusy} variant="contained" color="warning">
            Void Invoice
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function SalesInvoiceShow() {
  const sx = useMemo(() => ({ "& .RaShow-main": { paddingTop: 1 } }), []);
  return (
    <Show actions={<SalesInvoiceShowActions />} sx={sx}>
      <TabbedShowLayout>
        <TabbedShowLayout.Tab label="Overview">
          <SimpleShowLayout>
            <TextField source="invoice_no" label="Invoice #" />
            <ChipField source="status" />
            <TextField source="customer_name" label="Customer" />
            <TextField source="warehouse_name" label="Warehouse" />
            <DateField source="invoice_date" />
            <DateField source="due_date" />
            <NumberField source="exchange_rate" />
            <TextField source="pricing_currency" />
            <TextField source="settlement_currency" />
            <NumberField source="total_usd" />
            <NumberField source="total_lbp" />
            <DateField source="created_at" showTime />
          </SimpleShowLayout>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Lines">
          <ArrayField source="lines">
            <Datagrid bulkActionButtons={false}>
              <TextField source="item_sku" label="SKU" />
              <TextField source="item_name" label="Item" />
              <NumberField source="qty" />
              <NumberField source="unit_price_usd" label="Unit USD" />
              <NumberField source="unit_price_lbp" label="Unit LBP" />
              <NumberField source="line_total_usd" label="Total USD" />
              <NumberField source="line_total_lbp" label="Total LBP" />
            </Datagrid>
          </ArrayField>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Payments">
          <ArrayField source="payments">
            <Datagrid bulkActionButtons={false}>
              <TextField source="method" />
              <NumberField source="amount_usd" />
              <NumberField source="amount_lbp" />
              <DateField source="created_at" showTime />
            </Datagrid>
          </ArrayField>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Taxes">
          <ArrayField source="tax_lines">
            <Datagrid bulkActionButtons={false}>
              <TextField source="tax_code_id" label="Tax Code" />
              <NumberField source="base_usd" />
              <NumberField source="base_lbp" />
              <NumberField source="tax_usd" />
              <NumberField source="tax_lbp" />
              <DateField source="tax_date" />
            </Datagrid>
          </ArrayField>
        </TabbedShowLayout.Tab>
      </TabbedShowLayout>
    </Show>
  );
}
