"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import DataTable, { StatusToggleCell, EditIconButton, DeleteIconButton, type DataTableColumn } from "./DataTable";
import FormDrawer from "./FormDrawer";
import ConfirmDialog from "./ConfirmDialog";
import EmailContentEditor, { type EmailPlaceholder } from "./EmailContentEditor";
import EmailAddressListField from "./EmailAddressListField";
import DivineInput from "../divine/DivineInput";
import DivineListbox from "../divine/DivineListbox";
import DivineStatusSelect from "../divine/DivineStatusSelect";
import DivineButton from "../divine/DivineButton";
import { api, unwrap, type ApiEnvelope } from "../../lib/api";
import { useApiResource } from "../../lib/useApiResource";
import { MODULES, usePermissions } from "../../lib/permissions";
import { toast } from "../../lib/toastStore";
import { patchMasterStatus } from "../../lib/patchMasterStatus";
import { usePageSize } from "../../lib/usePageSize";
import type { EmailTemplateRecord } from "./EmailTemplatePage";

type Ref = { _id: string; name?: string; code?: string; subject?: string; htmlContent?: string };

export type EmailTemplateMappingRecord = {
  _id: string;
  entity: Ref | string;
  event: string;
  template: Ref | string;
  fromOverride: string | null;
  cc: string[];
  bcc: string[];
  subject: string;
  content: string;
  status: number;
};

type EmailEvent = {
  key: string;
  label: string;
  description: string;
  placeholders: EmailPlaceholder[];
};

type EntityOption = { _id: string; name: string; code: string; templeName?: string; logoUrl?: string };

type OptionsResponse = { entities: EntityOption[]; events: EmailEvent[] };

const schema = z.object({
  entity: z.string().min(1, "Entity is required"),
  event: z.string().min(1, "Event is required"),
  template: z.string().min(1, "Template is required"),
  fromOverride: z.string().trim().email("Enter a valid From email"),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string().trim().min(1, "Subject is required"),
  content: z.string().min(1, "Content is required"),
  status: z.number(),
});

type FormValues = z.infer<typeof schema>;

function refId(value: Ref | string | null | undefined) {
  if (!value) return "";
  return typeof value === "string" ? value : value._id;
}

function refLabel(value: Ref | string | null | undefined) {
  if (!value || typeof value === "string") return "—";
  return value.name || "—";
}

function mappingSubject(row: EmailTemplateMappingRecord) {
  if (row.subject?.trim()) return row.subject;
  if (typeof row.template === "object" && row.template.subject?.trim()) return row.template.subject;
  return "";
}

export default function EmailTemplateMappingPage() {
  const { can } = usePermissions();
  const canCreate = can(MODULES.emailTemplateMappings, "fullAccess");
  const canEdit = can(MODULES.emailTemplateMappings, "edit");
  const { items, total, list, create, update, remove } = useApiResource<EmailTemplateMappingRecord>(
    api,
    "/notifications/email-template-mappings"
  );
  const templateLibrary = useApiResource<EmailTemplateRecord>(api, "/notifications/email-templates");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplateMappingRecord | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplateMappingRecord | null>(null);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);

  useEffect(() => {
    list.run({ page, pageSize, search: search || undefined, status: statusFilter || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    api
      .get<ApiEnvelope<OptionsResponse>>("/notifications/email-template-mappings/options")
      .then((response) => {
        const data = unwrap(response);
        setEvents(data.events);
        setEntities(data.entities);
      })
      .catch(() => {
        setEvents([]);
        setEntities([]);
      });
    templateLibrary.list.run({ page: 1, pageSize: 100, status: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const eventKey = watch("event");
  const entityId = watch("entity");
  const placeholders = events.find((event) => event.key === eventKey)?.placeholders ?? [];
  const logoUrl = entities.find((entity) => entity._id === entityId)?.logoUrl || entities.find((entity) => entity.logoUrl)?.logoUrl || "";

  useEffect(() => {
    if (drawerOpen && !editing && entities.length === 1) {
      setValue("entity", entities[0]._id);
    }
  }, [drawerOpen, editing, entities, setValue]);

  function templateById(id: string): { subject: string; htmlContent: string } | null {
    const fromLibrary = templateLibrary.items.find((row) => row._id === id);
    if (fromLibrary) return fromLibrary;
    if (editing && refId(editing.template) === id && typeof editing.template === "object") {
      return {
        subject: editing.template.subject || "",
        htmlContent: editing.template.htmlContent || "",
      };
    }
    return null;
  }

  function fillFromTemplate(id: string) {
    const chosen = templateById(id);
    if (!chosen) return;
    setValue("subject", chosen.subject, { shouldValidate: true });
    setValue("content", chosen.htmlContent, { shouldValidate: true });
  }

  function openCreate() {
    setEditing(null);
    reset({
      entity: entities.length === 1 ? entities[0]._id : "",
      event: "",
      template: "",
      fromOverride: "",
      cc: [],
      bcc: [],
      subject: "",
      content: "",
      status: 1,
    });
    create.setError(null);
    templateLibrary.list.run({ page: 1, pageSize: 100, status: 1 });
    setDrawerOpen(true);
  }

  function openEdit(row: EmailTemplateMappingRecord) {
    const template = typeof row.template === "object" ? row.template : null;
    setEditing(row);
    reset({
      entity: refId(row.entity),
      event: row.event,
      template: refId(row.template),
      fromOverride: row.fromOverride || "",
      cc: row.cc || [],
      bcc: row.bcc || [],
      subject: row.subject || template?.subject || "",
      content: row.content || template?.htmlContent || "",
      status: row.status,
    });
    update.setError(null);
    setDrawerOpen(true);
  }

  const submit = handleSubmit(async (values) => {
    const body = {
      event: values.event,
      template: values.template,
      fromOverride: values.fromOverride,
      cc: values.cc,
      bcc: values.bcc,
      subject: values.subject,
      content: values.content,
      status: values.status,
    };
    const ok = editing
      ? await update.run(editing._id, body)
      : await create.run({ ...body, entity: values.entity });
    if (ok !== undefined) {
      setDrawerOpen(false);
      if (editing) toast.updated("Email template mapping updated successfully.");
      else toast.created("Email template mapping created successfully.");
    }
  });

  const eventLabel = (key: string) => events.find((event) => event.key === key)?.label || key;

  const templateOptions = useMemo(() => {
    const rows = templateLibrary.items.map((row) => ({ value: row._id, label: row.name }));
    const current = editing?.template;
    if (current && typeof current === "object" && !rows.some((row) => row.value === current._id)) {
      rows.unshift({ value: current._id, label: current.name || "Template" });
    }
    return rows;
  }, [templateLibrary.items, editing]);

  const columns: DataTableColumn<EmailTemplateMappingRecord>[] = [
    { key: "event", label: "Event", render: (row) => <span className="font-medium">{eventLabel(row.event)}</span> },
    { key: "template", label: "Template", render: (row) => <span>{refLabel(row.template)}</span> },
    {
      key: "from",
      label: "Email From",
      render: (row) => <span className="text-ink-500">{row.fromOverride || "Default sender"}</span>,
    },
    {
      key: "subject",
      label: "Subject",
      render: (row) => <span className="block max-w-[240px] truncate text-ink-500">{mappingSubject(row) || "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusToggleCell
          status={row.status}
          canEdit={canEdit}
          onChange={(status) => patchMasterStatus(update, row._id, status, "Email template mapping")}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Email Template Mapping"
        subtitle="Which message is sent for each event. The subject and content saved here are what go out — they do not change the template master."
        columns={columns}
        rows={items}
        rowKey={(row) => row._id}
        loading={list.submitting}
        search={search}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
        searchPlaceholder="Search mappings…"
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
        createLabel="Add Mapping"
        emptyMessage="No mappings yet — add one so the event can send mail."
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            {canEdit && <EditIconButton onClick={() => openEdit(row)} label="Edit email template mapping" />}
            {canCreate && <DeleteIconButton onClick={() => setDeleting(row)} />}
          </div>
        )}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this mapping?"
        message={
          deleting
            ? `${eventLabel(deleting.event)} will no longer send this message. The email template itself is kept, and can be edited again once nothing maps it.`
            : ""
        }
        confirmLabel="Delete mapping"
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
            toast.deleted("Email template mapping deleted successfully.");
          }
        }}
      />

      <FormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit Map Email Template" : "Add Map Email Template"}
        maxWidthClassName="max-w-5xl"
        footer={
          <div className="flex justify-end gap-3">
            <DivineButton variant="ghost" fullWidth={false} type="button" onClick={() => setDrawerOpen(false)}>
              Cancel
            </DivineButton>
            <DivineButton variant="flame" fullWidth={false} type="submit" form="email-mapping-form" loading={create.submitting || update.submitting}>
              {editing ? "Save changes" : "Save"}
            </DivineButton>
          </div>
        }
      >
        <form id="email-mapping-form" onSubmit={submit} noValidate className="space-y-5">
          <p className="text-right text-[12px] text-crimson-500">* denotes mandatory fields</p>
          <p className="rounded-lg border border-[#f0b4a0]/80 bg-ivory-50 px-3 py-2 text-[12.5px] leading-5 text-ink-500">
            Choose a template to fill the subject and content. If that text is right, save it. If not, change it here —
            this save does not update the Email Template master. The sent email uses this text inside the standard
            layout, and the logo is the one uploaded on Entity Master.
          </p>

          {entities.length === 0 && (
            <p className="text-[13px] text-crimson-500">No entity is assigned to this account, so a mapping cannot be saved.</p>
          )}

          {entities.length > 1 && (
            <Controller
              control={control}
              name="entity"
              render={({ field }) => (
                <DivineListbox
                  required
                  label="Entity"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={Boolean(editing)}
                  placeholder="Select entity"
                  options={entities.map((entity) => ({ value: entity._id, label: `${entity.name} (${entity.code})` }))}
                  error={errors.entity?.message}
                />
              )}
            />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="event"
              render={({ field }) => (
                <DivineListbox
                  required
                  label="Event"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select event"
                  options={events.map((event) => ({ value: event.key, label: event.label }))}
                  error={errors.event?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="template"
              render={({ field }) => (
                <DivineListbox
                  required
                  label="Template Name"
                  value={field.value}
                  onChange={(id) => {
                    field.onChange(id);
                    fillFromTemplate(id);
                  }}
                  placeholder="Select template"
                  options={templateOptions}
                  error={errors.template?.message}
                />
              )}
            />
          </div>

          <DivineInput
            staticLabel
            required
            type="email"
            label="Email From"
            placeholder="Enter from email"
            error={errors.fromOverride?.message}
            {...register("fromOverride")}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="cc"
              render={({ field }) => (
                <EmailAddressListField label="Email CC" value={field.value} onChange={field.onChange} error={errors.cc?.message} />
              )}
            />
            <Controller
              control={control}
              name="bcc"
              render={({ field }) => (
                <EmailAddressListField label="Email BCC" value={field.value} onChange={field.onChange} error={errors.bcc?.message} />
              )}
            />
          </div>

          <DivineInput staticLabel required label="Subject" placeholder="Enter subject" error={errors.subject?.message} {...register("subject")} />

          <Controller
            control={control}
            name="status"
            render={({ field }) => <DivineStatusSelect value={field.value} onChange={field.onChange} />}
          />

          <Controller
            control={control}
            name="content"
            render={({ field }) => (
              <EmailContentEditor
                required
                label="Content"
                value={field.value}
                onChange={field.onChange}
                placeholders={placeholders}
                logoUrl={logoUrl}
                error={errors.content?.message}
                hint="Placeholders match the selected event. You can also type them in the subject. An inactive mapping is not sent."
              />
            )}
          />
        </form>
      </FormDrawer>
    </>
  );
}
