"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import DataTable, { StatusToggleCell, EditIconButton, DeleteIconButton, type DataTableColumn } from "./DataTable";
import FormDrawer from "./FormDrawer";
import ConfirmDialog from "./ConfirmDialog";
import EmailContentEditor, { type EmailPlaceholder } from "./EmailContentEditor";
import DivineInput from "../divine/DivineInput";
import DivineTextarea from "../divine/DivineTextarea";
import DivineStatusSelect from "../divine/DivineStatusSelect";
import DivineButton from "../divine/DivineButton";
import { EyeIcon } from "../divine/icons";
import { api, unwrap, type ApiEnvelope } from "../../lib/api";
import { useApiResource } from "../../lib/useApiResource";
import { MODULES, usePermissions } from "../../lib/permissions";
import { toast } from "../../lib/toastStore";
import { patchMasterStatus } from "../../lib/patchMasterStatus";
import { usePageSize } from "../../lib/usePageSize";

export type EmailTemplateRecord = {
  _id: string;
  name: string;
  subject: string;
  htmlContent: string;
  description: string;
  status: number;
  isMapped: boolean;
};

type OptionsResponse = {
  entities: { logoUrl?: string }[];
  events: { placeholders: EmailPlaceholder[] }[];
};

const schema = z.object({
  name: z.string().trim().min(2, "Template name is required").max(150),
  subject: z.string().trim().min(1, "Mail subject is required"),
  description: z.string().trim().max(500),
  htmlContent: z.string().min(1, "Content is required"),
  status: z.number(),
});

type FormValues = z.infer<typeof schema>;

const LOCKED =
  "This template is used by an Email Template Mapping. You can still edit it — that only changes what is copied the next time someone chooses it. It cannot be deactivated or deleted while a mapping uses it.";

export default function EmailTemplatePage() {
  const { can } = usePermissions();
  const canCreate = can(MODULES.emailTemplates, "fullAccess");
  const canEdit = can(MODULES.emailTemplates, "edit");
  const { items, total, list, create, update, remove } = useApiResource<EmailTemplateRecord>(api, "/notifications/email-templates");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplateRecord | null>(null);
  const [viewing, setViewing] = useState<EmailTemplateRecord | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplateRecord | null>(null);
  const [placeholders, setPlaceholders] = useState<EmailPlaceholder[]>([]);
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    list.run({ page, pageSize, search: search || undefined, status: statusFilter || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    api
      .get<ApiEnvelope<OptionsResponse>>("/notifications/email-template-mappings/options")
      .then((response) => {
        const data = unwrap(response);
        setLogoUrl(data.entities.find((entity) => entity.logoUrl)?.logoUrl || "");
        const seen = new Set<string>();
        const merged: EmailPlaceholder[] = [];
        data.events.forEach((event) => {
          event.placeholders.forEach((item) => {
            if (seen.has(item.token)) return;
            seen.add(item.token);
            merged.push(item);
          });
        });
        setPlaceholders(merged);
      })
      .catch(() => setPlaceholders([]));
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  function openCreate() {
    setEditing(null);
    reset({ name: "", subject: "", description: "", htmlContent: "", status: 1 });
    create.setError(null);
    setDrawerOpen(true);
  }

  function openEdit(row: EmailTemplateRecord) {
    setEditing(row);
    reset({
      name: row.name,
      subject: row.subject,
      description: row.description || "",
      htmlContent: row.htmlContent,
      status: row.status,
    });
    update.setError(null);
    setDrawerOpen(true);
  }

  const submit = handleSubmit(async (values) => {
    const ok = editing ? await update.run(editing._id, values) : await create.run(values);
    if (ok !== undefined) {
      setDrawerOpen(false);
      if (editing) toast.updated("Email template updated successfully.");
      else toast.created("Email template created successfully.");
    }
  });

  const columns: DataTableColumn<EmailTemplateRecord>[] = useMemo(
    () => [
      { key: "name", label: "Template Name", render: (row) => <span className="font-medium">{row.name}</span> },
      {
        key: "subject",
        label: "Mail Subject",
        render: (row) => <span className="block max-w-[240px] truncate text-ink-500">{row.subject}</span>,
      },
      {
        key: "description",
        label: "Description",
        render: (row) => <span className="block max-w-[220px] truncate text-ink-500">{row.description || "—"}</span>,
      },
      {
        key: "mapped",
        label: "Mapping",
        render: (row) =>
          row.isMapped ? (
            <span className="text-[12px] font-semibold text-maroon" title={LOCKED}>
              In use
            </span>
          ) : (
            <span className="text-ink-400">—</span>
          ),
      },
      {
        key: "status",
        label: "Status",
        render: (row) => (
          <span title={row.isMapped ? LOCKED : undefined}>
            <StatusToggleCell
              status={row.status}
              canEdit={canEdit}
              disabled={row.isMapped && row.status === 1}
              onChange={(status) => {
                if (row.isMapped && status === 0) return;
                return patchMasterStatus(update, row._id, status, "Email template");
              }}
            />
          </span>
        ),
      },
    ],
    [canEdit, update]
  );

  return (
    <>
      <DataTable
        title="Email Template"
        subtitle="Reusable messages. A mapping copies one of these when it is chosen, and later edits on the mapping stay there."
        columns={columns}
        rows={items}
        rowKey={(row) => row._id}
        loading={list.submitting}
        search={search}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
        searchPlaceholder="Search templates…"
        statusFilter={statusFilter}
        onStatusFilterChange={(value) => {
          setPage(1);
          setStatusFilter(value);
        }}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPage(1);
          setPageSize(size);
        }}
        onCreate={canCreate ? openCreate : undefined}
        createLabel="Add Template"
        emptyMessage="No email templates yet — add the first one."
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setViewing(row)} aria-label="View email template" className="text-ink-300 hover:text-ink-100">
              <EyeIcon />
            </button>
            {canEdit && <EditIconButton onClick={() => openEdit(row)} label="Edit email template" />}
            {canCreate && !row.isMapped && <DeleteIconButton onClick={() => setDeleting(row)} />}
          </div>
        )}
      />

      <FormDrawer
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title="View Email Template"
        maxWidthClassName="max-w-3xl"
        footer={
          <DivineButton variant="ghost" type="button" onClick={() => setViewing(null)}>
            Close
          </DivineButton>
        }
      >
        {viewing && (
          <div className="space-y-4">
            {viewing.isMapped && (
              <p className="rounded-lg border border-gold-500/40 bg-ivory-50 px-3 py-2 text-[13px] text-maroon">{LOCKED}</p>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-amber-600">Template Name</p>
              <p className="mt-1 text-[15px] text-ink-100">{viewing.name}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-amber-600">Mail Subject</p>
              <p className="mt-1 text-[15px] text-ink-100">{viewing.subject}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-amber-600">Description</p>
              <p className="mt-1 text-[14px] text-ink-100">{viewing.description || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-amber-600">Content</p>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[#f0b4a0] bg-ivory-50 p-3 font-mono text-[12.5px] leading-6 text-ink-100">
                {viewing.htmlContent}
              </pre>
            </div>
          </div>
        )}
      </FormDrawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this email template?"
        message={deleting ? `"${deleting.name}" will be removed. This is refused if a mapping still uses it.` : ""}
        confirmLabel="Delete template"
        tone="danger"
        error={remove.error}
        loading={remove.submitting}
        onCancel={() => {
          remove.setError(null);
          setDeleting(null);
        }}
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await remove.run(deleting._id);
          if (ok !== undefined) {
            setDeleting(null);
            toast.deleted("Email template deleted successfully.");
          }
        }}
      />

      <FormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit Email Template" : "Add Email Template"}
        maxWidthClassName="max-w-5xl"
        footer={
          <div className="flex justify-end gap-3">
            <DivineButton variant="ghost" fullWidth={false} type="button" onClick={() => setDrawerOpen(false)}>
              Cancel
            </DivineButton>
            <DivineButton variant="flame" fullWidth={false} type="submit" form="email-template-form" loading={create.submitting || update.submitting}>
              {editing ? "Save changes" : "Save"}
            </DivineButton>
          </div>
        }
      >
        <form id="email-template-form" onSubmit={submit} noValidate className="space-y-5">
          <p className="text-right text-[12px] text-crimson-500">* denotes mandatory fields</p>
          <p className="rounded-lg border border-[#f0b4a0]/80 bg-ivory-50 px-3 py-2 text-[12.5px] leading-5 text-ink-500">
            This master only stores the message. Choosing it on an Email Template Mapping copies the subject and content
            into that mapping. Changing the mapping afterwards does not change this template. Write the inner text only —
            the logo and the card around the email come from the entity when the mail is sent.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DivineInput staticLabel required label="Template Name" error={errors.name?.message} {...register("name")} />
            <DivineInput staticLabel required label="Mail Subject" placeholder="Enter mail subject" error={errors.subject?.message} {...register("subject")} />
          </div>
          <DivineTextarea staticLabel label="Description" error={errors.description?.message} {...register("description")} />
          {editing?.isMapped && (
            <p className="rounded-lg border border-gold-500/40 bg-ivory-50 px-3 py-2 text-[13px] text-maroon">{LOCKED}</p>
          )}
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <DivineStatusSelect
                value={field.value}
                disabled={Boolean(editing?.isMapped && editing.status === 1)}
                onChange={(status) => {
                  if (editing?.isMapped && status === 0) return;
                  field.onChange(status);
                }}
              />
            )}
          />
          <Controller
            control={control}
            name="htmlContent"
            render={({ field }) => (
              <EmailContentEditor
                required
                label="Content"
                value={field.value}
                onChange={field.onChange}
                placeholders={placeholders}
                logoUrl={logoUrl}
                error={errors.htmlContent?.message}
                hint="Click a placeholder to insert it. These tokens are replaced when the email is sent."
              />
            )}
          />
        </form>
      </FormDrawer>
    </>
  );
}
