"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useRef, useCallback } from "react";
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

function ImageUpload({
  label,
  accept,
  error,
  onChange,
  value,
  category = "id",
  helpText,
}: {
  label: string;
  accept?: string;
  error?: string;
  onChange: (files: FileList | null) => void;
  value: FileList | null | undefined;
  category?: "id" | "visa";
  helpText?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);

  const validateImage = useCallback(
    async (file: File) => {
      setValidating(true);
      setValidationStatus(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("category", category);

        const res = await fetch("/api/validate-id", {
          method: "POST",
          body: formData,
        });
        const result = await res.json();
        setValidationStatus({ valid: result.valid, message: result.message });

        if (!result.valid) {
          onChange(null);
          setPreview(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          if (cameraInputRef.current) cameraInputRef.current.value = "";
        }
      } catch {
        setValidationStatus({ valid: true, message: "Validation skipped" });
      } finally {
        setValidating(false);
      }
    },
    [category, onChange]
  );

  const handleFile = useCallback(
    (files: FileList | null) => {
      if (files && files[0]) {
        onChange(files);
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(files[0]);
        validateImage(files[0]);
      } else {
        onChange(null);
        setPreview(null);
        setValidationStatus(null);
      }
    },
    [onChange, validateImage]
  );

  const clearFile = () => {
    onChange(null);
    setPreview(null);
    setValidationStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  return (
    <div>
      <Label className="mb-2 block text-sm font-medium text-brand-green-dark">
        {label}
      </Label>
      {preview ? (
        <div className="flex items-start gap-4">
          <div className="relative inline-block">
            <img
              src={preview}
              alt="Document preview"
              className="h-32 w-auto rounded-xl border border-brand-mist object-cover shadow-soft"
            />
            <button
              type="button"
              onClick={clearFile}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-md"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 pt-1">
            {validating && (
              <p className="flex items-center gap-2 text-sm text-brand-green-dark/70">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
                Verifying document...
              </p>
            )}
            {validationStatus && !validating && (
              <p
                className={cn(
                  "text-sm font-medium",
                  validationStatus.valid
                    ? "text-brand-green"
                    : "text-red-500"
                )}
              >
                {validationStatus.valid ? "✓ " : "✗ "}
                {validationStatus.message}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-mist bg-brand-sand/50 px-4 py-6 text-sm font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-brand-sand"
          >
            <UploadIcon className="h-5 w-5 text-brand-green" />
            Upload file
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-mist bg-brand-sand/50 px-4 py-6 text-sm font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-brand-sand"
          >
            <CameraIcon className="h-5 w-5 text-brand-green" />
            Take photo
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept ?? "image/*"}
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      <p className="mt-1.5 text-xs text-brand-green-dark/50">
        {helpText || "Accepted: Driving licence, Aadhaar card, or Passport. Max 10 MB."}
      </p>
    </div>
  );
}

export function SelfCheckinForm() {
  const { date, time } = getNow();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

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
    },
  });

  const nationality = watch("nationality");

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

      if (data.idCardImage?.[0]) {
        formData.append("idCardImage", data.idCardImage[0]);
      }
      if (data.visaImage?.[0]) {
        formData.append("visaImage", data.visaImage[0]);
      }

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

        {/* ID Card Upload */}
        <ImageUpload
          label="ID Card (Driving licence / Aadhaar / Passport)"
          error={errors.idCardImage?.message as string | undefined}
          value={watch("idCardImage")}
          onChange={(files) =>
            setValue("idCardImage", files, { shouldValidate: true })
          }
        />

        {/* Visa (conditional) */}
        {nationality && nationality !== "India" && (
          <ImageUpload
            label="Visa document (required for non-Indian nationals)"
            category="visa"
            error={errors.visaImage?.message as string | undefined}
            value={watch("visaImage")}
            onChange={(files) =>
              setValue("visaImage", files, { shouldValidate: true })
            }
            helpText="Upload a clear photo of your valid visa. Max 10 MB."
          />
        )}
      </div>

      <div className="mt-10">
        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Complete Check-in"}
        </Button>
      </div>
    </form>
  );
}
