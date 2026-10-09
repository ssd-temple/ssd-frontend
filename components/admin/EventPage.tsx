"use client";

import { useEffect, useState } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import DataTable, { StatusToggleCell, EditIconButton, DeleteIconButton, MasterImageCell, type DataTableColumn } from "./DataTable";
import FormDrawer from "./FormDrawer";
import ConfirmDialog from "./ConfirmDialog";
import ImportExportBar from "./ImportExportBar";
import ImportReviewModal from "./ImportReviewModal";
import DivineInput from "../divine/DivineInput";
import DivineTextarea from "../divine/DivineTextarea";
import DivineListbox, { type ListboxOption } from "../divine/DivineListbox";
import DivineMultiSelect from "../divine/DivineMultiSelect";
import DivineDatePicker from "../divine/DivineDatePicker";
import DivineTimePicker from "../divine/DivineTimePicker";
import DivineRadioGroup from "../divine/DivineRadioGroup";
import DivineStatusSelect from "../divine/DivineStatusSelect";
import DivineButton from "../divine/DivineButton";
import DivineMasterImageUpload from "../divine/DivineMasterImageUpload";
import TamilNameField from "./TamilNameField";
import { withOptionalImages } from "../../lib/withOptionalImage";
import { PlusIcon, CalendarIcon, CloseIcon } from "../divine/icons";
import { formatHHMMDisplay, formatTempleDate, parseISODateString } from "../../lib/datetime";
import { api, unwrap, type ApiEnvelope } from "../../lib/api";
import { useApiResource } from "../../lib/useApiResource";
import { MODULES, usePermissions } from "../../lib/permissions";
import { toast } from "../../lib/toastStore";
import { patchMasterStatus } from "../../lib/patchMasterStatus";
import { usePageSize } from "../../lib/usePageSize";

type Ref = { _id: string; name: string };

export type DateType = "SINGLE" | "MULTIPLE" | "RANGE";

export type Event = {
  _id: string;
  code: string;
  name: string;
  tamilName: string;
  description: string;
  category: Ref | null;
  subCategory: Ref | null;
  deityMapping: Ref[];
  dateType?: DateType;
  eventDates?: string[];
  startDate: string;
  endDate: string;
  isFamilyMembersRequired?: boolean;
  maxFamilyMembers?: number;
  termsAndConditions?: string;
  isSlotRequired: boolean;
  slotDetails: {
    slotName: string;
    date: string;
    startTime: string;
    endTime: string;
    totalSeats: number;
    bookedSeats?: number;
    heldSeats?: number;
    status: number;
  }[];
  /** Set by the server: at least one slot has a confirmed booking. Such an event cannot be deleted or made inactive, and its booked slots are locked. */
  hasBookings?: boolean;
  hasHeldSeats?: boolean;
  salePrice: number;
  generalLedger?: { _id: string; name: string; code?: string } | null;
  /** Legacy - events saved before the General Ledger field. */
  gstClassification?: string;
  displayOrder: number;
  posVisibility: boolean;
  publicVisibility: boolean;
  status: number;
  image: string | null;
  /** Legacy wide banner from before the Slider Image field was removed from the form; still shown as a fallback picture. */
  sliderImage: string | null;
};

const DATE_TYPE_OPTIONS = [
  { value: "SINGLE", label: "Single date" },
  { value: "MULTIPLE", label: "Multiple dates" },
  { value: "RANGE", label: "Date range" },
];

const SLOT_STATUS_OPTIONS = [
  { value: "1", label: "Active" },
  { value: "0", label: "Inactive" },
];

const slotDetailSchema = z.object({
  slotName: z.string().trim().min(1, "Required"),
  date: z.string().min(1, "Required"),
  startTime: z.string().min(1, "Required"),
  endTime: z.string().min(1, "Required"),
  totalSeats: z.number().int().min(0),
  bookedSeats: z.number().int().min(0),
  heldSeats: z.number().int().min(0),
  // The seat limit the slot had when the form was opened - a slot with
  // bookings may only go up from here.
  minSeats: z.number().int().min(0),
  status: z.number(),
});

/**
 * startDate/endDate are what the rest of the system reads, so whatever the
 * date type, they end up as the first and last day of the event: a single
 * date is both, multiple dates take the earliest and latest picked, and a
 * range is the two ends as entered.
 */
function effectiveRange(d: { dateType: DateType; eventDates: string[]; startDate: string; endDate: string }) {
  if (d.dateType === "SINGLE") return { start: d.startDate, end: d.startDate };
  if (d.dateType === "MULTIPLE") {
    const sorted = [...d.eventDates].sort();
    return { start: sorted[0] ?? "", end: sorted[sorted.length - 1] ?? "" };
  }
  return { start: d.startDate, end: d.endDate };
}

const schema = z
  .object({
    code: z.string().trim().min(1, "Code is required").max(30),
    name: z.string().trim().min(1, "Name is required").max(150),
    tamilName: z.string().trim(),
    description: z.string().trim().max(1000),
    category: z.string().min(1, "Category is required"),
    subCategory: z.string(),
    deityMapping: z.array(z.string()),
    dateType: z.enum(["SINGLE", "MULTIPLE", "RANGE"]),
    eventDates: z.array(z.string()),
    startDate: z.string(),
    endDate: z.string(),
    isFamilyMembersRequired: z.boolean(),
    maxFamilyMembers: z.number().int().min(1, "Must be at least 1"),
    termsAndConditions: z.string().trim().max(5000),
    isSlotRequired: z.boolean(),
    slotDetails: z.array(slotDetailSchema),
    salePrice: z.number({ message: "Enter a price" }).min(0.01, "Must be greater than 0 (at least 0.01)"),
    generalLedger: z.string().min(1, "GL account is required"),
    displayOrder: z.number().int().min(0),
    posVisibility: z.boolean(),
    publicVisibility: z.boolean(),
    status: z.number(),
  })
  .superRefine((data, ctx) => {
    const { start, end } = effectiveRange(data);
    if (data.dateType === "MULTIPLE") {
      if (data.eventDates.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select at least one date", path: ["eventDates"] });
      }
    } else if (data.dateType === "SINGLE") {
      if (!data.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date is required", path: ["startDate"] });
    } else {
      if (!data.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Start date is required", path: ["startDate"] });
      else if (!data.endDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date is required", path: ["endDate"] });
      else if (data.endDate < data.startDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date cannot be before the start date", path: ["endDate"] });
      }
    }

    data.slotDetails.forEach((slot, i) => {
      const used = slot.bookedSeats + slot.heldSeats;
      if (slot.totalSeats > 0 && slot.totalSeats < used) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${used} seat(s) booked or held`,
          path: ["slotDetails", i, "totalSeats"],
        });
      } else if (slot.bookedSeats > 0 && slot.minSeats > 0 && slot.totalSeats > 0 && slot.totalSeats < slot.minSeats) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Can only be increased (now ${slot.minSeats})`,
          path: ["slotDetails", i, "totalSeats"],
        });
      }
    });

    if (data.isSlotRequired) {
      if (data.slotDetails.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add at least one slot", path: ["slotDetails"] });
      } else if (data.slotDetails.some((s) => s.date && ((start && s.date < start) || (end && s.date > end)))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Every slot date must fall between the first and last event date",
          path: ["slotDetails"],
        });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

const DEFAULT_VALUES: FormValues = {
  code: "",
  name: "",
  tamilName: "",
  description: "",
  category: "",
  subCategory: "",
  deityMapping: [],
  dateType: "RANGE",
  eventDates: [],
  startDate: "",
  endDate: "",
  isFamilyMembersRequired: false,
  maxFamilyMembers: 2,
  termsAndConditions: "",
  isSlotRequired: false,
  slotDetails: [],
  salePrice: 0,
  generalLedger: "",
  displayOrder: 1,
  posVisibility: true,
  publicVisibility: true,
  status: 1,
};

async function fetchOptions(path: string, labelField = "name"): Promise<ListboxOption[]> {
  const res = await api.get<ApiEnvelope<{ items: Record<string, unknown>[] }>>(path, {
    params: { status: 1, pageSize: 100 },
  });
  return unwrap(res).items.map((row) => ({ value: String(row._id), label: String(row[labelField]) }));
}

export default function EventPage() {
  const { can } = usePermissions();
  const canCreate = can(MODULES.events, "fullAccess");
  const canEdit = can(MODULES.events, "edit");
  const canView = can(MODULES.events, "view");
  const { items, total, list, create, update, remove } = useApiResource<Event>(api, "/masters/events");
  const [importOpen, setImportOpen] = useState(false);

  const [categoryOptions, setCategoryOptions] = useState<ListboxOption[]>([]);
  const [subCategoryOptions, setSubCategoryOptions] = useState<ListboxOption[]>([]);
  const [deityOptions, setDeityOptions] = useState<ListboxOption[]>([]);
  const [glOptions, setGlOptions] = useState<ListboxOption[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [deleting, setDeleting] = useState<Event | null>(null);
  const [createImage, setCreateImage] = useState<File | null>(null);
  const [editImage, setEditImage] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);

  useEffect(() => {
    fetchOptions("/masters/categories").then(setCategoryOptions);
    fetchOptions("/masters/sub-categories").then(setSubCategoryOptions);
    fetchOptions("/masters/deities").then(setDeityOptions);
    fetchOptions("/masters/general-ledgers").then(setGlOptions);
  }, []);

  useEffect(() => {
    list.run({ page, pageSize, search: search || undefined, status: statusFilter || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, statusFilter]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULT_VALUES });

  const { fields: slotFields, append: appendSlot, remove: removeSlot } = useFieldArray({ control, name: "slotDetails" });
  const isSlotRequired = watch("isSlotRequired");
  const dateType = watch("dateType");
  const eventDates = watch("eventDates");
  const isFamilyMembersRequired = watch("isFamilyMembersRequired");
  const { start: startDate, end: endDate } = effectiveRange({
    dateType,
    eventDates: eventDates ?? [],
    startDate: watch("startDate"),
    endDate: watch("endDate"),
  });
  const nameValue = watch("name") ?? "";
  const tamilNameValue = watch("tamilName") ?? "";

  function openCreate() {
    setEditing(null);
    reset(DEFAULT_VALUES);
    setCreateImage(null);
    setImageRemoved(false);
    create.setError(null);
    setDrawerOpen(true);
  }

  function openEdit(event: Event) {
    setEditing(event);
    reset({
      code: event.code,
      name: event.name,
      tamilName: event.tamilName,
      description: event.description,
      category: event.category?._id ?? "",
      subCategory: event.subCategory?._id ?? "",
      deityMapping: event.deityMapping.map((d) => d._id),
      dateType: event.dateType ?? "RANGE",
      eventDates: (event.eventDates ?? []).map((d) => d.slice(0, 10)),
      startDate: event.startDate.slice(0, 10),
      endDate: event.endDate.slice(0, 10),
      isFamilyMembersRequired: event.isFamilyMembersRequired ?? false,
      maxFamilyMembers: event.maxFamilyMembers ?? 2,
      termsAndConditions: event.termsAndConditions ?? "",
      isSlotRequired: event.isSlotRequired,
      slotDetails: event.slotDetails.map((s) => ({
        slotName: s.slotName,
        date: s.date.slice(0, 10),
        startTime: s.startTime,
        endTime: s.endTime,
        totalSeats: s.totalSeats,
        bookedSeats: s.bookedSeats ?? 0,
        heldSeats: s.heldSeats ?? 0,
        minSeats: s.totalSeats,
        status: s.status,
      })),
      salePrice: event.salePrice,
      generalLedger: event.generalLedger?._id ?? "",
      displayOrder: event.displayOrder,
      posVisibility: event.posVisibility,
      publicVisibility: event.publicVisibility,
      status: event.status,
    });
    setEditImage(null);
    setImageRemoved(false);
    update.setError(null);
    setDrawerOpen(true);
  }

  const submit = handleSubmit(async (values) => {
    const payload = withOptionalImages(
      {
        ...values,
        subCategory: values.subCategory || null,
        startDate: effectiveRange(values).start,
        endDate: effectiveRange(values).end,
        eventDates: values.dateType === "MULTIPLE" ? [...values.eventDates].sort() : values.dateType === "SINGLE" ? [values.startDate] : [],
        maxFamilyMembers: values.isFamilyMembersRequired ? values.maxFamilyMembers : 2,
        // minSeats is only the form's own memory of the original limit - the server does not take it.
        slotDetails: values.isSlotRequired ? values.slotDetails.map(({ minSeats: _minSeats, ...slot }) => slot) : [],
      },
      [
        { fieldName: "image", file: editing ? editImage : createImage, existingValue: editing?.image ?? null, removed: imageRemoved },
      ],
    );
    const ok = editing ? await update.run(editing._id, payload) : await create.run(payload);
    if (ok !== undefined) {
      setDrawerOpen(false);
      if (editing) toast.updated("Event updated successfully.");
      else toast.created("Event created successfully.");
    }
  });

  const columns: DataTableColumn<Event>[] = [
    { key: "image", label: "Image", render: (e) => <MasterImageCell src={e.image || e.sliderImage} alt={e.name} /> },
    { key: "code", label: "Code", render: (e) => <span className="font-medium tabular-nums text-amber-700">{e.code}</span> },
    { key: "name", label: "Name", render: (e) => e.name },
    {
      key: "category",
      label: "Category",
      render: (e) => <span className="text-ink-500">{e.category?.name ?? "—"}</span>,
    },
    {
      key: "dates",
      label: "Dates",
      render: (e) => (
        <span className="tabular-nums text-ink-500">
          {formatTempleDate(new Date(e.startDate))} – {formatTempleDate(new Date(e.endDate))}
        </span>
      ),
    },
    { key: "status", label: "Status", render: (e) => (
      <span title={e.hasBookings ? "This event has bookings, so it cannot be made inactive." : undefined}>
        <StatusToggleCell
          status={e.status}
          canEdit={canEdit}
          disabled={e.hasBookings}
          onChange={(status) => patchMasterStatus(update, e._id, status, "Event")}
        />
      </span>
    ) },
  ];

  return (
    <>
      <DataTable
        title="Event Master"
        subtitle="Temple events — deity mapping, date range, slot capacity, and visibility."
        columns={columns}
        rows={items}
        rowKey={(e) => e._id}
        loading={list.submitting}
        search={search}
        onSearchChange={(v) => {
          setPage(1);
          setSearch(v);
        }}
        searchPlaceholder="Search by name or code…"
        statusFilter={statusFilter}
        onStatusFilterChange={(v) => {
          setPage(1);
          setStatusFilter(v);
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
        createLabel="Add Event"
        emptyMessage="No events yet — create the first one."
        toolbarActions={
          <ImportExportBar
            client={api}
            basePath="/masters/events"
            entityLabel="Event"
            canExport={canView}
            canImport={canCreate}
            onOpenImport={() => setImportOpen(true)}
          />
        }
        rowActions={(e) => (
          <div className="flex justify-end gap-2">
            {canEdit && <EditIconButton onClick={() => openEdit(e)} />}
            {canCreate && (
              <DeleteIconButton
                onClick={() => setDeleting(e)}
                disabledReason={
                  e.hasBookings
                    ? "This event has bookings, so it cannot be deleted."
                    : e.hasHeldSeats
                      ? "Seats on this event are being held by open carts right now."
                      : undefined
                }
              />
            )}
          </div>
        )}
      />

      <ImportReviewModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        client={api}
        basePath="/masters/events"
        entityLabel="Event"
        previewFields={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "category", label: "Category" },
          { key: "startDate", label: "Start Date" },
        ]}
        onImported={() => list.run({ page, pageSize, search: search || undefined, status: statusFilter || undefined })}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this event?"
        message={deleting ? `"${deleting.name}" will be removed.` : ""}
        confirmLabel="Delete event"
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
            toast.deleted("Event deleted successfully.");
          }
        }}
      />

      <FormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit Event" : "Add Event"}
        subtitle={editing ? `${editing.name} · ${editing.code}` : "Define a new temple event."}
        error={create.error || update.error}
        maxWidthClassName="max-w-6xl"
        footer={
          <div className="flex justify-end gap-3">
            <DivineButton variant="ghost" fullWidth={false} type="button" onClick={() => setDrawerOpen(false)}>
              Cancel
            </DivineButton>
            <DivineButton variant="flame" fullWidth={false} type="submit" form="event-form" loading={create.submitting || update.submitting}>
              {editing ? "Save changes" : "Save"}
            </DivineButton>
          </div>
        }
      >
        <form id="event-form" onSubmit={submit} noValidate className="space-y-5">
          <p className="text-right text-[12px] text-crimson-500">* denotes mandatory fields</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DivineInput staticLabel label="Event Code" required error={errors.code?.message} {...register("code")} />
            <DivineInput staticLabel label="Event Name" required error={errors.name?.message} {...register("name")} />
            <TamilNameField staticLabel
              englishName={nameValue}
              value={tamilNameValue}
              onChange={(v) => setValue("tamilName", v, { shouldDirty: true })}
              error={errors.tamilName?.message}
            />
          </div>

          <DivineTextarea staticLabel label="Description" error={errors.description?.message} {...register("description")} />

          <DivineTextarea
            staticLabel
            label="Terms & Conditions"
            rows={6}
            placeholder="Enter the terms & conditions for this event..."
            error={errors.termsAndConditions?.message}
            {...register("termsAndConditions")}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <DivineListbox
                  label="Category" required
                  value={field.value}
                  onChange={field.onChange}
                  options={categoryOptions}
                  placeholder="Select Category"
                  error={errors.category?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="subCategory"
              render={({ field }) => (
                <DivineListbox
                  label="Sub Category"
                  value={field.value}
                  onChange={field.onChange}
                  options={subCategoryOptions}
                  placeholder="Select Sub Category"
                />
              )}
            />
            <Controller
              control={control}
              name="deityMapping"
              render={({ field }) => (
                <DivineMultiSelect
                  label="Deity Mapping"
                  values={field.value}
                  onChange={field.onChange}
                  options={deityOptions}
                  placeholder="Select deities"
                />
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Controller
              control={control}
              name="dateType"
              render={({ field }) => (
                <DivineListbox
                  label="Date Type"
                  value={field.value}
                  onChange={(v) => {
                    if (!v) return;
                    field.onChange(v);
                    // Each type has its own dates; clear them so a stale pick
                    // from another type cannot be saved.
                    setValue("startDate", "");
                    setValue("endDate", "");
                    setValue("eventDates", []);
                  }}
                  options={DATE_TYPE_OPTIONS}
                  clearable={false}
                />
              )}
            />
            {dateType === "SINGLE" && (
              <Controller
                control={control}
                name="startDate"
                render={({ field }) => (
                  <DivineDatePicker staticLabel
                    label="Event Date" required
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.startDate?.message}
                  />
                )}
              />
            )}
            {dateType === "MULTIPLE" && (
              <Controller
                control={control}
                name="eventDates"
                render={({ field }) => (
                  <div>
                    <DivineDatePicker staticLabel
                      mode="multiple"
                      label="Event Dates" required
                      values={field.value}
                      onChangeValues={field.onChange}
                      placeholder="Select one or more dates"
                      error={errors.eventDates?.message}
                    />
                    {field.value.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {field.value.map((d) => (
                          <span
                            key={d}
                            className="inline-flex items-center gap-1 rounded-md border border-maroon/25 bg-maroon/5 px-2 py-0.5 text-[12px] font-medium tabular-nums text-maroon"
                          >
                            {formatTempleDate(parseISODateString(d) ?? new Date(d))}
                            <button
                              type="button"
                              aria-label={`Remove ${d}`}
                              onClick={() => field.onChange(field.value.filter((v: string) => v !== d))}
                              className="text-maroon/60 hover:text-crimson-500"
                            >
                              <CloseIcon className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              />
            )}
            {dateType === "RANGE" && (
              <Controller
                control={control}
                name="startDate"
                render={({ field: startField }) => (
                  <Controller
                    control={control}
                    name="endDate"
                    render={({ field: endField }) => (
                      <DivineDatePicker staticLabel
                        mode="range"
                        label="Event Date Range" required
                        rangeValue={{ start: startField.value, end: endField.value }}
                        onChangeRange={(start, end) => {
                          startField.onChange(start);
                          endField.onChange(end);
                        }}
                        placeholder="Select from date - to date"
                        error={errors.startDate?.message || errors.endDate?.message}
                      />
                    )}
                  />
                )}
              />
            )}
            <Controller
              control={control}
              name="isSlotRequired"
              render={({ field }) => <DivineRadioGroup boxed label="Slot Required" value={field.value} onChange={field.onChange} />}
            />
          </div>

          {isSlotRequired && (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-orange-50 px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 text-[13px] font-bold text-ink-100">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-100 text-orange-600">
                      <CalendarIcon className="h-4 w-4" />
                    </span>
                    SLOT DETAILS
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink-500">Slot date must be between Event Start Date and End Date.</p>
                  {editing?.hasBookings && (
                    <p className="mt-1 text-[11.5px] font-medium text-amber-700">
                      Slots with bookings are locked - only their number of seats can be increased.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    appendSlot({ slotName: "", date: "", startTime: "", endTime: "", totalSeats: 0, bookedSeats: 0, heldSeats: 0, minSeats: 0, status: 1 })
                  }
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-orange-600 transition-colors hover:bg-orange-50"
                >
                  <PlusIcon /> Add Slot
                </button>
              </div>

              <div className="overflow-x-auto">
              {slotFields.length > 0 && (
                <div className="hidden min-w-[72rem] grid-cols-[minmax(10rem,1.4fr)_10.5rem_11rem_11rem_7rem_6rem_9rem_2.75rem] gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 lg:grid">
                  <span>Slot Name <span className="text-crimson-500">*</span></span>
                  <span>Slot Date <span className="text-crimson-500">*</span></span>
                  <span>Start Time <span className="text-crimson-500">*</span></span>
                  <span>End Time <span className="text-crimson-500">*</span></span>
                  <span>No. of Seats</span>
                  <span>Booked</span>
                  <span>Status</span>
                  <span />
                </div>
              )}

              <div className="divide-y divide-gray-100">
                {slotFields.length === 0 && <p className="px-4 py-3 text-[12.5px] text-ink-500">No slots yet.</p>}
                {slotFields.map((row, index) => {
                  // A slot with a confirmed booking is frozen: only its seat limit can go up.
                  const booked = watch(`slotDetails.${index}.bookedSeats`) ?? 0;
                  const held = watch(`slotDetails.${index}.heldSeats`) ?? 0;
                  const locked = booked > 0;
                  const lockedField =
                    "h-10 w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-100 px-3 text-[13.5px] text-ink-500 outline-none";
                  const slotError = (errors.slotDetails as { totalSeats?: { message?: string } }[] | undefined)?.[index]?.totalSeats?.message;
                  return (
                  <div
                    key={row.id}
                    className="grid min-w-0 grid-cols-1 items-start gap-2 px-4 py-3 sm:grid-cols-2 lg:min-w-[72rem] lg:grid-cols-[minmax(10rem,1.4fr)_10.5rem_11rem_11rem_7rem_6rem_9rem_2.75rem]"
                  >
                    <input
                      placeholder="Slot Name"
                      readOnly={locked}
                      title={locked ? "This slot has bookings, so its name cannot be changed." : undefined}
                      {...register(`slotDetails.${index}.slotName`)}
                      className={
                        locked
                          ? `${lockedField} sm:col-span-2 lg:col-span-1`
                          : "h-10 w-full rounded-lg border border-[#f0b4a0] bg-white px-3 text-[13.5px] text-ink-100 outline-none transition-colors hover:border-[#e8a090] focus:border-[#e8590c] sm:col-span-2 lg:col-span-1"
                      }
                    />
                    <input
                      type="date"
                      min={startDate || undefined}
                      max={endDate || undefined}
                      readOnly={locked}
                      title={locked ? "This slot has bookings, so its date cannot be changed." : undefined}
                      {...register(`slotDetails.${index}.date`)}
                      className={
                        locked
                          ? lockedField
                          : "h-10 w-full rounded-lg border border-[#f0b4a0] bg-white px-3 text-[13.5px] text-ink-100 outline-none transition-colors hover:border-[#e8a090] focus:border-[#e8590c]"
                      }
                    />
                    <Controller
                      control={control}
                      name={`slotDetails.${index}.startTime`}
                      render={({ field }) =>
                        locked ? (
                          <div title="This slot has bookings, so its time cannot be changed." className={`${lockedField} flex items-center`}>
                            {formatHHMMDisplay(field.value)}
                          </div>
                        ) : (
                          <DivineTimePicker label="Start Time" compact value={field.value} onChange={field.onChange} />
                        )
                      }
                    />
                    <Controller
                      control={control}
                      name={`slotDetails.${index}.endTime`}
                      render={({ field }) =>
                        locked ? (
                          <div title="This slot has bookings, so its time cannot be changed." className={`${lockedField} flex items-center`}>
                            {formatHHMMDisplay(field.value)}
                          </div>
                        ) : (
                          <DivineTimePicker label="End Time" compact value={field.value} onChange={field.onChange} />
                        )
                      }
                    />
                    <div>
                      <input
                        type="number"
                        min={locked ? watch(`slotDetails.${index}.minSeats`) : Math.max(0, booked + held)}
                        title={locked ? "Seats can only be increased on a slot that has bookings." : undefined}
                        {...register(`slotDetails.${index}.totalSeats`, { valueAsNumber: true })}
                        className={`h-10 w-full rounded-lg border bg-white px-3 text-[13.5px] text-ink-100 outline-none transition-colors hover:border-[#e8a090] focus:border-[#e8590c] ${
                          slotError ? "border-crimson-500" : "border-[#f0b4a0]"
                        }`}
                      />
                      {slotError && <p className="mt-1 text-[11px] leading-tight text-crimson-500">{slotError}</p>}
                    </div>
                    <div
                      title={`${booked} booked${held > 0 ? `, ${held} held by open carts` : ""}`}
                      className="flex h-10 items-center rounded-lg border border-[#f0b4a0] bg-gray-50 px-3 text-[13.5px] tabular-nums text-ink-100"
                    >
                      {booked}
                      <span className="ml-1 text-ink-500">/ {watch(`slotDetails.${index}.totalSeats`) || 0}</span>
                      {held > 0 && <span className="ml-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label={`${held} seats held`} />}
                    </div>
                    <Controller
                      control={control}
                      name={`slotDetails.${index}.status`}
                      render={({ field }) => (
                        <DivineListbox
                          value={String(field.value)}
                          onChange={(v) => field.onChange(Number(v))}
                          options={SLOT_STATUS_OPTIONS}
                          formChrome
                          clearable={false}
                          disabled={locked}
                        />
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => removeSlot(index)}
                      disabled={locked || held > 0}
                      aria-label="Remove slot"
                      title={locked ? "This slot has bookings, so it cannot be removed." : held > 0 ? "Seats on this slot are held by open carts." : "Remove slot"}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors lg:justify-self-start ${
                        locked || held > 0
                          ? "cursor-not-allowed bg-gray-100 text-gray-300"
                          : "bg-crimson-500/10 text-crimson-500 hover:bg-crimson-500/20"
                      }`}
                    >
                      <CloseIcon className="h-4 w-4" />
                      <span className="sr-only">Remove slot</span>
                    </button>
                  </div>
                  );
                })}
              </div>
              </div>
              {errors.slotDetails?.message && (
                <p className="px-4 pb-3 text-[12.5px] text-crimson-500">{errors.slotDetails.message}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Controller
              control={control}
              name="isFamilyMembersRequired"
              render={({ field }) => (
                <DivineRadioGroup
                  boxed
                  label="Family Members Required"
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    if (v) setValue("maxFamilyMembers", 2);
                  }}
                />
              )}
            />
            {isFamilyMembersRequired && (
              <DivineInput
                staticLabel
                label="Max Family Members"
                type="number"
                error={errors.maxFamilyMembers?.message}
                {...register("maxFamilyMembers", { valueAsNumber: true })}
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DivineInput staticLabel
              label="Sale Price (GST Inclusive)"
              type="number"
              step="0.01"
              error={errors.salePrice?.message}
              {...register("salePrice", { valueAsNumber: true })}
            />
            <Controller
              control={control}
              name="generalLedger"
              render={({ field }) => (
                <DivineListbox
                  label="General Ledger (GL)" required
                  value={field.value}
                  onChange={field.onChange}
                  options={glOptions}
                  placeholder="Select GL Account"
                  error={errors.generalLedger?.message}
                />
              )}
            />
            <DivineInput staticLabel
              label="Display Order"
              type="number"
              error={errors.displayOrder?.message}
              {...register("displayOrder", { valueAsNumber: true })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Controller
              control={control}
              name="posVisibility"
              render={({ field }) => <DivineRadioGroup boxed label="Temple POS" value={field.value} onChange={field.onChange} />}
            />
            <Controller
              control={control}
              name="publicVisibility"
              render={({ field }) => <DivineRadioGroup boxed label="Customer POS" value={field.value} onChange={field.onChange} />}
            />
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <DivineStatusSelect value={field.value} onChange={field.onChange} disabled={Boolean(editing?.hasBookings)} />
              )}
            />
          </div>

          <DivineMasterImageUpload
            label="Event Image"
            value={editing?.image}
            onChange={(file) => {
              (editing ? setEditImage : setCreateImage)(file);
              setImageRemoved(!file);
            }}
          />

        </form>
      </FormDrawer>
    </>
  );
}
