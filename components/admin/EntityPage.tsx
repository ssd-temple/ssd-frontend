"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import DataTable, { MasterImageCell, StatusToggleCell, EditIconButton, DeleteIconButton, type DataTableColumn } from "./DataTable";
import FormDrawer from "./FormDrawer";
import ConfirmDialog from "./ConfirmDialog";
import DivineInput from "../divine/DivineInput";
import DivineTextarea from "../divine/DivineTextarea";
import DivineStatusSelect from "../divine/DivineStatusSelect";
import DivineMasterImageUpload from "../divine/DivineMasterImageUpload";
import DivineButton from "../divine/DivineButton";
import { api } from "../../lib/api";
import { useApiResource } from "../../lib/useApiResource";
import { useAuthStore } from "../../lib/authStore";
import { USER_TYPES } from "../../lib/userTypes";
import { toast } from "../../lib/toastStore";
import { patchMasterStatus } from "../../lib/patchMasterStatus";
import { usePageSize } from "../../lib/usePageSize";
import { withOptionalImage } from "../../lib/withOptionalImage";
import { SG_MOBILE_ERROR, SG_MOBILE_REGEX, sanitizeMobileInput } from "../../lib/mobileNumber";

type Address = {
  block: string;
  unit: string;
  street: string;
  country: string;
  pincode: string;
};

export type EntityRecord = {
  _id: string;
  code: string;
  name: string;
  templeName: string;
  templeTamilName: string;
  address?: Address;
  email: string;
  mobileNumber: string;
  gstNumber: string;
  description: string;
  logoUrl: string;
  status: number;
};

const schema = z.object({
  code: z.string().trim().min(2, "Code is required").max(20),
  name: z.string().trim().min(2, "Name is required").max(150),
  templeName: z.string().trim().min(2, "Temple name is required").max(200),
  templeTamilName: z.string().trim().max(200),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
  mobileNumber: z.string().trim().refine((value) => value === "" || SG_MOBILE_REGEX.test(value), SG_MOBILE_ERROR),
  gstNumber: z.string().trim().max(30),
  description: z.string().trim().max(500),
  block: z.string().trim().max(80),
  unit: z.string().trim().max(40),
  street: z.string().trim().max(200),
  country: z.string().trim().max(80),
  pincode: z.string().trim().max(12),
  status: z.number(),
});

type FormValues = z.infer<typeof schema>;

function toPayload(values: FormValues) {
  return {
    code: values.code,
    name: values.name,
    templeName: values.templeName,
    templeTamilName: values.templeTamilName,
    email: values.email,
    mobileNumber: values.mobileNumber,
    gstNumber: values.gstNumber,
    description: values.description,
    status: values.status,
    address: {
      block: values.block,
      unit: values.unit,
      street: values.street,
      country: values.country,
      pincode: values.pincode,
    },
  };
}

export default function EntityPage() {
  const user = useAuthStore((s) => s.user);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const { items, total, list, create, update, remove } = useApiResource<EntityRecord>(api, "/masters/entities");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize } = usePageSize();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [deleting, setDeleting] = useState<EntityRecord | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  useEffect(() => {
    setAllowed(user?.userType === USER_TYPES.SUPER_ADMIN);
  }, [user]);

  useEffect(() => {
    if (!allowed) return;
    list.run({ page, pageSize, search: search || undefined, status: statusFilter || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, page, pageSize, search, statusFilter]);

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  function openEdit(row: EntityRecord) {
    setEditing(row);
    setLogo(null);
    setLogoRemoved(false);
    reset({
      code: row.code,
      name: row.name,
      templeName: row.templeName,
      templeTamilName: row.templeTamilName || "",
      email: row.email || "",
      mobileNumber: row.mobileNumber || "",
      gstNumber: row.gstNumber || "",
      description: row.description || "",
      block: row.address?.block || "",
      unit: row.address?.unit || "",
      street: row.address?.street || "",
      country: row.address?.country || "",
      pincode: row.address?.pincode || "",
      status: row.status,
    });
    update.setError(null);
    setDrawerOpen(true);
  }

  const submit = handleSubmit(async (values) => {
    const payload = withOptionalImage(toPayload(values), logo, {
      fieldName: "logoUrl",
      existingValue: editing?.logoUrl ?? null,
      imageRemoved: logoRemoved,
    });
    const ok = editing ? await update.run(editing._id, payload) : await create.run(payload);
    if (ok !== undefined) {
      setDrawerOpen(false);
      if (editing) toast.updated("Entity updated successfully.");
      else toast.created("Entity created successfully.");
    }
  });

  const columns: DataTableColumn<EntityRecord>[] = [
    {
      key: "logo",
      label: "Logo",
      render: (row) => <MasterImageCell src={row.logoUrl || null} alt={row.templeName} />,
    },
    { key: "code", label: "Code", render: (row) => <span className="font-medium tabular-nums text-amber-700">{row.code}</span> },
    { key: "name", label: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "templeName", label: "Temple Name", render: (row) => <span>{row.templeName}</span> },
    { key: "email", label: "Email", render: (row) => <span className="text-ink-500">{row.email || "—"}</span> },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusToggleCell
          status={row.status}
          canEdit
          onChange={(status) => patchMasterStatus(update, row._id, status, "Entity")}
        />
      ),
    },
  ];

  if (allowed === null) return null;
  if (!allowed) {
    return (
      <div className="rounded-2xl border border-[#f0b4a0] bg-white px-6 py-10 text-center">
        <p className="text-[16px] font-semibold text-maroon">Entity Master is for the system administrator only.</p>
      </div>
    );
  }

  return (
    <>
      <DataTable
        title="Entity Master"
        subtitle="The temple record. The logo uploaded here is the one placed at the top of every email."
        columns={columns}
        rows={items}
        rowKey={(row) => row._id}
        loading={list.submitting}
        search={search}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
        searchPlaceholder="Search entities…"
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
        emptyMessage="No entity yet."
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <EditIconButton onClick={() => openEdit(row)} label="Edit entity" />
            <DeleteIconButton onClick={() => setDeleting(row)} />
          </div>
        )}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this entity?"
        message={deleting ? `"${deleting.name}" will be removed. This is refused while users, customers, or email mappings still belong to it.` : ""}
        confirmLabel="Delete entity"
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
            toast.deleted("Entity deleted successfully.");
          }
        }}
      />

      <FormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit Entity" : "Add Entity"}
        maxWidthClassName="max-w-3xl"
        footer={
          <div className="flex justify-end gap-3">
            <DivineButton variant="ghost" fullWidth={false} type="button" onClick={() => setDrawerOpen(false)}>
              Cancel
            </DivineButton>
            <DivineButton variant="flame" fullWidth={false} type="submit" form="entity-form" loading={create.submitting || update.submitting}>
              {editing ? "Save changes" : "Save"}
            </DivineButton>
          </div>
        }
      >
        <form id="entity-form" onSubmit={submit} noValidate className="space-y-5">
          <p className="text-right text-[12px] text-crimson-500">* denotes mandatory fields</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DivineInput staticLabel required label="Code" error={errors.code?.message} {...register("code")} />
            <DivineInput staticLabel required label="Name" error={errors.name?.message} {...register("name")} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DivineInput staticLabel required label="Temple Name" placeholder="Enter temple name" error={errors.templeName?.message} {...register("templeName")} />
            <DivineInput staticLabel label="Temple Name (Tamil)" placeholder="Enter Tamil name" error={errors.templeTamilName?.message} {...register("templeTamilName")} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DivineInput staticLabel label="Email" placeholder="Enter email" error={errors.email?.message} {...register("email")} />
            <DivineInput
              staticLabel
              label="Mobile Number"
              placeholder="Enter mobile number"
              error={errors.mobileNumber?.message}
              {...register("mobileNumber")}
              onChange={(e) => setValue("mobileNumber", sanitizeMobileInput(e.target.value), { shouldValidate: true })}
            />
          </div>
          <DivineInput staticLabel label="GST Number" placeholder="Enter GST number" error={errors.gstNumber?.message} {...register("gstNumber")} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DivineInput staticLabel label="Block" error={errors.block?.message} {...register("block")} />
            <DivineInput staticLabel label="Unit" error={errors.unit?.message} {...register("unit")} />
            <DivineInput staticLabel label="Street" error={errors.street?.message} {...register("street")} />
            <DivineInput staticLabel label="Country" error={errors.country?.message} {...register("country")} />
            <DivineInput staticLabel label="Pincode" error={errors.pincode?.message} {...register("pincode")} />
            <Controller
              control={control}
              name="status"
              render={({ field }) => <DivineStatusSelect value={field.value} onChange={field.onChange} />}
            />
          </div>
          <DivineTextarea staticLabel label="Description" error={errors.description?.message} {...register("description")} />
          <DivineMasterImageUpload
            label="Logo"
            value={logoRemoved ? null : editing?.logoUrl}
            maxBytes={300 * 1024}
            hint="JPG, PNG or WebP, up to 300 KB. This image is the header of every email."
            onChange={(file) => {
              setLogo(file);
              setLogoRemoved(!file);
            }}
          />
        </form>
      </FormDrawer>
    </>
  );
}
