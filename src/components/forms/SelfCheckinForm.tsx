"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useRef, useCallback, useEffect } from "react";
import { checkinSchema, type CheckinFormData } from "@/lib/checkinSchema";
import { countries } from "@/content/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CameraIcon, UploadIcon, CheckCircle2Icon, XIcon } from "lucide-react";

const countryDialCodes: Record<string, string> = {
  India: "+91", Afghanistan: "+93", Albania: "+355", Algeria: "+213",
  Argentina: "+54", Australia: "+61", Austria: "+43", Bangladesh: "+880",
  Belgium: "+32", Bhutan: "+975", Brazil: "+55", Cambodia: "+855",
  Canada: "+1", Chile: "+56", China: "+86", Colombia: "+57",
  Denmark: "+45", Egypt: "+20", Finland: "+358", France: "+33",
  Germany: "+49", Greece: "+30", Hungary: "+36", Iceland: "+354",
  Indonesia: "+62", Iran: "+98", Iraq: "+964", Ireland: "+353",
  Israel: "+972", Italy: "+39", Japan: "+81", Jordan: "+962",
  Kenya: "+254", Kuwait: "+965", Malaysia: "+60", Maldives: "+960",
  Mexico: "+52", Morocco: "+212", Myanmar: "+95", Nepal: "+977",
  Netherlands: "+31", "New Zealand": "+64", Nigeria: "+234", Norway: "+47",
  Oman: "+968", Pakistan: "+92", Philippines: "+63", Poland: "+48",
  Portugal: "+351", Qatar: "+974", Romania: "+40", Russia: "+7",
  "Saudi Arabia": "+966", Singapore: "+65", "South Africa": "+27",
  "South Korea": "+82", Spain: "+34", "Sri Lanka": "+94", Sweden: "+46",
  Switzerland: "+41", Thailand: "+66", Turkey: "+90", "United Arab Emirates": "+971",
  "United Kingdom": "+44", "United States": "+1", Vietnam: "+84",
};

function getNow() {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().slice(0, 5);
  return { date, time };
}

function CountrySelect({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = countries.filter((c) =>
    c.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        placeholder="Search country..."
        value={open ? search : value}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setSearch("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className={cn(error && "border-red-400 ring-red-100")}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-brand-mist bg-white shadow-lift">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-brand-green-dark/60">
              No country found
            </li>
          ) : (
            filtered.map((c) => (
              <li
                key={c}
                className={cn(
                  "cursor-pointer px-4 py-2.5 text-sm transition-colors hover:bg-brand-sand",
                  c === value && "bg-brand-green/[0.06] font-medium text-brand-green"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c);
                  setSearch("");
                  setOpen(false);
                  inputRef.current?.blur();
                }}
              >
                {c}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

type DocFile = { file: File; preview: string };

const ACCEPTED_FILE_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

function MultiDocUpload({
  label,
  error,
  files,
  onAdd,
  onRemove,
  onValidate,
  validating,
  validationMsg,
  helpText,
}: {
  label: string;
  error?: string;
  files: DocFile[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  onValidate?: () => void;
  validating?: boolean;
  validationMsg?: { valid: boolean; message: string } | null;
  helpText?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") return;
      if (file.size <= 10 * 1024 * 1024) onAdd(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  return (
    <div>
      <Label className="mb-2 block text-sm font-medium text-brand-green-dark">
        {label}
      </Label>

      {files.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {files.map((doc, i) => (
            <div key={i} className="relative">
              {doc.file.type === "application/pdf" ? (
                <div className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border border-brand-mist bg-brand-sand/50 shadow-soft">
                  <span className="text-2xl">PDF</span>
                  <span className="mt-1 max-w-[5rem] truncate text-[9px] text-brand-green-dark/60">{doc.file.name}</span>
                </div>
              ) : (
                <img
                  src={doc.preview}
                  alt={`Document ${i + 1}`}
                  className="h-24 w-24 rounded-xl border border-brand-mist object-cover shadow-soft"
                />
              )}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-mist bg-brand-sand/50 px-4 py-4 text-sm font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-brand-sand"
        >
          <UploadIcon className="h-5 w-5 text-brand-green" />
          {files.length > 0 ? "Add more" : "Upload file"}
        </button>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-mist bg-brand-sand/50 px-4 py-4 text-sm font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-brand-sand"
        >
          <CameraIcon className="h-5 w-5 text-brand-green" />
          Take photo
        </button>
      </div>

      {files.length > 0 && onValidate && (
        <button
          type="button"
          onClick={onValidate}
          disabled={validating}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-green/[0.08] px-4 py-2 text-sm font-medium text-brand-green transition-colors hover:bg-brand-green/[0.14] disabled:opacity-50"
        >
          {validating ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
              Verifying...
            </>
          ) : (
            "Verify document"
          )}
        </button>
      )}

      {validationMsg && !validating && (
        <p className={cn("mt-2 text-sm font-medium", validationMsg.valid ? "text-brand-green" : "text-red-500")}>
          {validationMsg.valid ? "✓ " : "✗ "}{validationMsg.message}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      <p className="mt-1.5 text-xs text-brand-green-dark/50">
        {helpText || "Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."}
      </p>
    </div>
  );
}

export function SelfCheckinForm() {
  const { date, time } = getNow();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [idFiles, setIdFiles] = useState<DocFile[]>([]);
  const [visaFiles, setVisaFiles] = useState<DocFile[]>([]);
  const [idValidationMsg, setIdValidationMsg] = useState<{ valid: boolean; message: string } | null>(null);
  const [validatingId, setValidatingId] = useState(false);
  const [idValidated, setIdValidated] = useState(false);
  const [visaValidationMsg, setVisaValidationMsg] = useState<{ valid: boolean; message: string } | null>(null);
  const [validatingVisa, setValidatingVisa] = useState(false);
  const [validationEnabled, setValidationEnabled] = useState(true);
  const [detectedIdType, setDetectedIdType] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.image_validation === "off") {
          setValidationEnabled(false);
          setIdValidated(true);
        }
      })
      .catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<CheckinFormData>({
    resolver: zodResolver(checkinSchema),
    defaultValues: {
      arrivalDate: date,
      arrivalTime: time,
      name: "",
      numberOfPersons: "",
      contactNumber: "",
      stayingDays: "",
      comingFrom: "",
      nationality: "India",
      emergencyName: "",
      emergencyPhone: "",
      idType: undefined,
    },
  });

  const nationality = watch("nationality");

  const addIdFile = (file: File) => {
    if (file.type === "application/pdf") {
      const newFiles = [...idFiles, { file, preview: "" }];
      setIdFiles(newFiles);
      setValue("idImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setIdValidationMsg(null);
      if (validationEnabled) setIdValidated(false);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const newFiles = [...idFiles, { file, preview: e.target?.result as string }];
      setIdFiles(newFiles);
      setValue("idImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setIdValidationMsg(null);
      if (validationEnabled) setIdValidated(false);
    };
    reader.readAsDataURL(file);
  };

  const removeIdFile = (index: number) => {
    const newFiles = idFiles.filter((_, i) => i !== index);
    setIdFiles(newFiles);
    setValue("idImages", newFiles.length > 0 ? newFiles.map((f) => f.file) : null, { shouldValidate: true });
    if (validationEnabled) setIdValidated(false);
    setIdValidationMsg(null);
  };

  const validateIdFiles = async () => {
    if (idFiles.length === 0) return;
    setValidatingId(true);
    setIdValidationMsg(null);
    try {
      const firstImage = idFiles.find((f) => f.file.type.startsWith("image/"));
      const fileToValidate = firstImage?.file || idFiles[0].file;

      const idType = watch("idType");
      const guestName = watch("name");
      const formData = new FormData();
      formData.append("file", fileToValidate);
      formData.append("category", "id");
      if (idType) formData.append("idType", idType);
      if (guestName) formData.append("guestName", guestName);

      const res = await fetch("/api/validate-id", { method: "POST", body: formData });
      const result = await res.json();
      setIdValidationMsg({ valid: result.valid, message: result.message });

      if (result.valid) {
        setIdValidated(true);
        setDetectedIdType(null);
      } else if (result.layers?.includes("type_mismatch") && result.documentType !== "unknown") {
        setIdValidated(false);
        setDetectedIdType(result.documentType);
      } else {
        setIdValidated(false);
        setDetectedIdType(null);
        setIdFiles([]);
        setValue("idImages", null, { shouldValidate: true });
      }
    } catch {
      setIdValidationMsg({ valid: true, message: "Validation skipped" });
      setIdValidated(true);
    } finally {
      setValidatingId(false);
    }
  };

  const addVisaFile = (file: File) => {
    if (file.type === "application/pdf") {
      const newFiles = [...visaFiles, { file, preview: "" }];
      setVisaFiles(newFiles);
      setValue("visaImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setVisaValidationMsg(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const newFiles = [...visaFiles, { file, preview: e.target?.result as string }];
      setVisaFiles(newFiles);
      setValue("visaImages", newFiles.map((f) => f.file), { shouldValidate: true });
      setVisaValidationMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const removeVisaFile = (index: number) => {
    const newFiles = visaFiles.filter((_, i) => i !== index);
    setVisaFiles(newFiles);
    setValue("visaImages", newFiles.length > 0 ? newFiles.map((f) => f.file) : null, { shouldValidate: true });
    if (newFiles.length === 0) setVisaValidationMsg(null);
  };

  const validateVisaFiles = async () => {
    if (visaFiles.length === 0) return;
    setValidatingVisa(true);
    setVisaValidationMsg(null);
    try {
      const firstImage = visaFiles.find((f) => f.file.type.startsWith("image/"));
      const fileToValidate = firstImage?.file || visaFiles[0].file;

      const formData = new FormData();
      formData.append("file", fileToValidate);
      formData.append("category", "visa");

      const res = await fetch("/api/validate-id", { method: "POST", body: formData });
      const result = await res.json();
      setVisaValidationMsg({ valid: result.valid, message: result.message });

      if (!result.valid) {
        setVisaFiles([]);
        setValue("visaImages", null, { shouldValidate: true });
      }
    } catch {
      setVisaValidationMsg({ valid: true, message: "Validation skipped" });
    } finally {
      setValidatingVisa(false);
    }
  };

  const onSubmit = async (data: CheckinFormData) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("arrivalDate", data.arrivalDate);
      formData.append("arrivalTime", data.arrivalTime);
      formData.append("name", data.name);
      formData.append("numberOfPersons", data.numberOfPersons);
      formData.append("contactNumber", data.contactNumber);
      formData.append("stayingDays", data.stayingDays);
      formData.append("comingFrom", data.comingFrom);
      formData.append("nationality", data.nationality);
      formData.append("emergencyName", data.emergencyName);
      formData.append("emergencyPhone", data.emergencyPhone);
      formData.append("idType", data.idType);

      idFiles.forEach((doc) => {
        formData.append("idImages", doc.file);
      });

      visaFiles.forEach((doc) => {
        formData.append("visaImages", doc.file);
      });

      const res = await fetch("/api/checkin", {
        method: "POST",
        body: formData,
      });

      if (res.status === 422) {
        const errData = await res.json();
        alert(errData.error || "Document validation failed. Please upload a valid ID.");
        return;
      }

      if (!res.ok) throw new Error("Submission failed");

      setSuccess(true);
      reset();
      setIdFiles([]);
      setVisaFiles([]);
      setIdValidationMsg(null);
      setVisaValidationMsg(null);
      setIdValidated(false);
    } catch {
      alert("Something went wrong. Please try again or contact the front desk.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-brand-mist bg-white p-8 text-center shadow-card md:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
          <CheckCircle2Icon className="h-8 w-8 text-brand-green" />
        </div>
        <h2 className="mt-6 font-display text-2xl font-bold text-brand-green">
          Check-in complete!
        </h2>
        <p className="mt-3 text-brand-green-dark/80">
          Welcome to Goko Hostel. Our team has been notified. Enjoy your stay!
        </p>
        <Button
          type="button"
          variant="ctaOutline"
          className="mt-8"
          onClick={() => setSuccess(false)}
        >
          Submit another check-in
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mx-auto max-w-2xl rounded-3xl border border-brand-mist bg-white p-6 shadow-card md:p-10"
    >
      <h2 className="font-display text-2xl font-bold text-brand-green md:text-3xl">
        Guest Self Check-in
      </h2>
      <p className="mt-2 text-sm text-brand-green-dark/70">
        Please fill in your details. All fields are required.
      </p>

      <div className="mt-8 space-y-6">
        {/* Date & Time */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="arrivalDate">Date of arrival</Label>
            <Input
              id="arrivalDate"
              type="date"
              {...register("arrivalDate")}
              className={cn(errors.arrivalDate && "border-red-400")}
            />
            {errors.arrivalDate && (
              <p className="mt-1 text-xs text-red-500">{errors.arrivalDate.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="arrivalTime">Time of arrival</Label>
            <Input
              id="arrivalTime"
              type="time"
              {...register("arrivalTime")}
              className={cn(errors.arrivalTime && "border-red-400")}
            />
            {errors.arrivalTime && (
              <p className="mt-1 text-xs text-red-500">{errors.arrivalTime.message}</p>
            )}
          </div>
        </div>

        {/* Name */}
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            placeholder="Enter your full name"
            {...register("name")}
            className={cn(errors.name && "border-red-400")}
            autoComplete="name"
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
          )}
        </div>

        {/* Number of persons & Staying days */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="numberOfPersons">Number of persons</Label>
            <Input
              id="numberOfPersons"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 2"
              {...register("numberOfPersons")}
              className={cn(errors.numberOfPersons && "border-red-400")}
            />
            {errors.numberOfPersons && (
              <p className="mt-1 text-xs text-red-500">
                {errors.numberOfPersons.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="stayingDays">Staying number of days</Label>
            <Input
              id="stayingDays"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 3"
              {...register("stayingDays")}
              className={cn(errors.stayingDays && "border-red-400")}
            />
            {errors.stayingDays && (
              <p className="mt-1 text-xs text-red-500">{errors.stayingDays.message}</p>
            )}
          </div>
        </div>

        {/* Nationality */}
        <div>
          <Label>Nationality</Label>
          <CountrySelect
            value={nationality}
            onChange={(val) => setValue("nationality", val, { shouldValidate: true })}
            error={errors.nationality?.message}
          />
          {errors.nationality && (
            <p className="mt-1 text-xs text-red-500">{errors.nationality.message}</p>
          )}
        </div>

        {/* Coming from */}
        <div>
          <Label htmlFor="comingFrom">Coming from (city/place)</Label>
          <Input
            id="comingFrom"
            placeholder="e.g. Mumbai"
            {...register("comingFrom")}
            className={cn(errors.comingFrom && "border-red-400")}
          />
          {errors.comingFrom && (
            <p className="mt-1 text-xs text-red-500">{errors.comingFrom.message}</p>
          )}
        </div>

        {/* Contact number */}
        <div>
          <Label htmlFor="contactNumber">Contact number</Label>
          <div className="flex gap-2">
            <div className="flex h-9 w-[5rem] shrink-0 items-center justify-center rounded-md border border-input bg-brand-sand/50 px-2 text-sm font-medium text-brand-green-dark">
              {countryDialCodes[nationality] || "+91"}
            </div>
            <Input
              id="contactNumber"
              type="tel"
              inputMode="tel"
              placeholder="98765 43210"
              {...register("contactNumber")}
              className={cn("flex-1", errors.contactNumber && "border-red-400")}
              autoComplete="tel"
            />
          </div>
          {errors.contactNumber && (
            <p className="mt-1 text-xs text-red-500">{errors.contactNumber.message}</p>
          )}
        </div>

        {/* Emergency contact */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="emergencyName">Emergency contact name</Label>
            <Input
              id="emergencyName"
              placeholder="e.g. Parent or friend"
              {...register("emergencyName")}
              className={cn(errors.emergencyName && "border-red-400")}
            />
            {errors.emergencyName && (
              <p className="mt-1 text-xs text-red-500">{errors.emergencyName.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="emergencyPhone">Emergency contact phone</Label>
            <div className="flex gap-2">
              <div className="flex h-9 w-[5rem] shrink-0 items-center justify-center rounded-md border border-input bg-brand-sand/50 px-2 text-sm font-medium text-brand-green-dark">
                {countryDialCodes[nationality] || "+91"}
              </div>
              <Input
                id="emergencyPhone"
                type="tel"
                inputMode="tel"
                placeholder="98765 43210"
                {...register("emergencyPhone")}
                className={cn("flex-1", errors.emergencyPhone && "border-red-400")}
              />
            </div>
            {errors.emergencyPhone && (
              <p className="mt-1 text-xs text-red-500">{errors.emergencyPhone.message}</p>
            )}
          </div>
        </div>

        {/* ID Type Selection */}
        <div>
          <Label htmlFor="idType">ID document type</Label>
          <select
            id="idType"
            {...register("idType")}
            onChange={(e) => {
              setValue("idType", e.target.value as any, { shouldValidate: true });
              if (detectedIdType && e.target.value === detectedIdType && idFiles.length > 0) {
                setIdValidated(true);
                setIdValidationMsg({ valid: true, message: `${detectedIdType.replace("_", " ")} detected. ID type updated.` });
                setDetectedIdType(null);
              }
            }}
            className={cn(
              "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring",
              errors.idType && "border-red-400"
            )}
          >
            <option value="">Select ID type...</option>
            <option value="aadhaar">Aadhaar Card</option>
            <option value="driving_licence">Driving Licence</option>
            <option value="passport">Passport</option>
          </select>
          {errors.idType && (
            <p className="mt-1 text-xs text-red-500">{errors.idType.message}</p>
          )}
        </div>

        {/* ID Upload (multiple images/PDF) */}
        <MultiDocUpload
          label="ID document (upload front & back)"
          error={errors.idImages?.message as string | undefined}
          files={idFiles}
          onAdd={addIdFile}
          onRemove={removeIdFile}
          onValidate={validationEnabled ? validateIdFiles : undefined}
          validating={validatingId}
          validationMsg={validationEnabled ? idValidationMsg : null}
          helpText="Upload front and back of your ID. Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."
        />

        {/* Visa (conditional, multiple images/PDF) */}
        {nationality && nationality !== "India" && (
          <MultiDocUpload
            label="Visa document (required for non-Indian nationals)"
            error={errors.visaImages?.message as string | undefined}
            files={visaFiles}
            onAdd={addVisaFile}
            onRemove={removeVisaFile}
            onValidate={validationEnabled ? validateVisaFiles : undefined}
            validating={validatingVisa}
            validationMsg={validationEnabled ? visaValidationMsg : null}
            helpText="Upload visa pages. Accepted: JPEG, PNG, WebP, PDF. Max 10 MB per file."
          />
        )}
      </div>

      <div className="mt-10">
        {validationEnabled && !idValidated && idFiles.length > 0 && (
          <p className="mb-3 text-center text-sm text-brand-red">
            Please click &quot;Verify document&quot; before submitting
          </p>
        )}
        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={submitting || (validationEnabled && !idValidated)}
        >
          {submitting ? "Submitting..." : "Complete Check-in"}
        </Button>
      </div>
    </form>
  );
}
